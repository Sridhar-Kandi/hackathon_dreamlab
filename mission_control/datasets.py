"""Record aligned simulator samples and prepare successful episodes for local validation."""

import argparse
import base64
import json
import math
import re
from collections.abc import Mapping
from contextlib import ExitStack
from pathlib import Path

from . import execution


FPS = 20
EXPORT_FPS = 10
CAMERAS = {name: f"observation.images.{role}" for name, role in execution.CAMERAS.items()}
AXES = [f"{side}_{joint}" for side in ("right", "left")
        for joint in ("joint1", "joint2", "joint3", "joint4", "joint5", "joint6", "gripper")]
YAM_CONFIG = {
    "state": {"right_arm": [0, 6], "right_gripper": [6, 7], "left_arm": [7, 13], "left_gripper": [13, 14]},
    "action": {"right_arm": [0, 6], "right_gripper": [6, 7], "left_arm": [7, 13], "left_gripper": [13, 14]},
    "video": {role: CAMERAS[name] for name, role in execution.CAMERAS.items()},
    "head_camera": "overhead",
}


class EpisodeRecorder:
    def __init__(self, path):
        self.count = 0
        self.error = None
        self.file = None
        try:
            self.file = path.open("x", encoding="utf-8")
        except OSError:
            self.error = "Could not open the aligned episode file."

    def add(self, frame, step_id, instruction, state, left, right, cameras):
        if self.error:
            return
        try:
            sample = dict(frame=frame, timestamp=frame / FPS, step_id=step_id, instruction=instruction,
                          state=[float(value) for side in ("right", "left") for value in state[side]],
                          action=[float(value) for arm in (right, left) for value in arm],
                          cameras={name: frame.decode("ascii") if isinstance(frame, bytes) else frame
                                   for name, frame in (cameras or {}).items()})
            self.file.write(json.dumps(sample, allow_nan=False) + "\n")
            self.count += 1
        except (OSError, ValueError):
            self.error = "Could not record a complete aligned sample."

    def close(self):
        if self.file is None:
            return
        try:
            self.file.close()
        except OSError:
            self.error = "Could not flush the episode to disk."


def episodes():
    for job in execution.jobs():
        folder = execution.run_dir(job["id"])
        for row in execution.read_lines(folder / "results.jsonl"):
            episode = row.get("episode")
            attempt = row.get("attempt_id", "")
            if not episode or not re.fullmatch(r"[a-f0-9]{32}", attempt):
                continue
            path = folder / "attempts" / attempt / "episode.jsonl"
            reasons = []
            if row["outcome"] != "success":
                reasons.append("Trial did not verify all placements.")
            if episode.get("error") or not episode.get("frames") or not path.is_file() or episode["frames"] != row.get("rows"):
                reasons.append("Synchronized episode is incomplete.")
            if not row.get("initial_state_fingerprint"):
                reasons.append("Reset fingerprint is missing.")
            yield dict(id=attempt, run_id=job["id"], seed=row["seed"], frames=episode["frames"], source=episode["source"],
                       fingerprint=row.get("initial_state_fingerprint"), eligible=not reasons, reasons=reasons,
                       instruction=row["task"], path=path)


def list_episodes():
    return [{key: value for key, value in episode.items() if key != "path"} for episode in episodes()]


def export_episode(root, episode, index, task_ids, start_index):
    import av
    import pyarrow as pa
    import pyarrow.parquet as parquet

    from PIL import Image
    from io import BytesIO

    chunk = f"chunk-{index // 1000:03}"
    name = f"episode_{index:06}"
    videos = {role: root / "videos" / chunk / key / f"{name}.mp4" for role, key in CAMERAS.items()}
    data_dir = root / "data" / chunk
    data_dir.mkdir(parents=True, exist_ok=True)
    columns = {k: [] for k in ("observation.state", "action", "timestamp", "frame_index",
                               "episode_index", "index", "task_index", "next.done")}
    formats = {}
    tasks = []
    with ExitStack() as stack:
        outputs = {}
        for role, path in videos.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            output = stack.enter_context(av.open(str(path), "w"))
            video = output.add_stream("libx264", rate=EXPORT_FPS)
            video.pix_fmt = "yuv420p"
            outputs[role] = output, video
        raw_count = 0
        with episode["path"].open(encoding="utf-8") as stream:
            for frame, line in enumerate(stream):
                row = json.loads(line)
                state, action = row["state"], row["action"]
                exported = frame % (FPS // EXPORT_FPS) == 0
                if (row["frame"] != frame or row["timestamp"] != frame / FPS
                        or len(state) != 14 or len(action) != 14
                        or not all(math.isfinite(value) for value in (*state, *action))
                        or (exported and set(row["cameras"]) != set(CAMERAS))):
                    raise ValueError(f"Incomplete sample at frame {frame}.")
                raw_count += 1
                # Dream Labs accepts 10 Hz for upsampling, so take synchronized
                # observation/action pairs every other tick without interpolation.
                if not exported:
                    continue
                position = len(columns["frame_index"])
                for role, (output, video) in outputs.items():
                    raw = base64.b64decode(row["cameras"][role], validate=True)
                    with Image.open(BytesIO(raw)) as image:
                        shape = [image.height, image.width, len(image.getbands())]
                        if image.format != "JPEG" or image.mode != "RGB" or formats.setdefault(role, shape) != shape:
                            raise ValueError(f"Invalid {role} camera frame {frame}.")
                        if frame == 0:
                            video.width, video.height = image.size
                        sample = av.VideoFrame.from_image(image)
                    for packet in video.encode(sample):
                        output.mux(packet)
                instruction = row["instruction"]
                if instruction not in tasks:
                    tasks.append(instruction)
                task = task_ids.setdefault(instruction, len(task_ids))
                for key, value in zip(columns, (state, action, position / EXPORT_FPS, position, index,
                                                 start_index + position, task, False)):
                    columns[key].append(value)
        for output, video in outputs.values():
            for packet in video.encode():
                output.mux(packet)
    count = len(columns["index"])
    if raw_count != episode["frames"]:
        raise ValueError("Episode frame count differs from its committed result.")
    columns["next.done"][-1] = True
    types = (pa.list_(pa.float32(), 14), pa.list_(pa.float32(), 14), pa.float32(),
             pa.int64(), pa.int64(), pa.int64(), pa.int64(), pa.bool_())
    parquet.write_table(pa.table({k: pa.array(v, type=t) for (k, v), t in zip(columns.items(), types)}),
                        data_dir / f"{name}.parquet")
    return {"episode_index": index, "tasks": tasks, "length": count}, formats


def export_dataset(output, selected, held_out):
    all_episodes = list(episodes())
    known = {episode["id"] for episode in all_episodes}
    if not selected or set(selected) - known or len(set(selected)) != len(selected):
        raise ValueError("Provide distinct recorded episode IDs from the list command.")
    hold_fingerprints = {episode["fingerprint"] for episode in all_episodes if episode["seed"] in held_out}
    chosen = [episode for episode in all_episodes if episode["id"] in selected]
    if any(not episode["eligible"] or episode["seed"] in held_out or episode["fingerprint"] in hold_fingerprints
           for episode in chosen):
        raise ValueError("Selected episodes include failed, incomplete or held-out resets.")
    write_dataset(output, chosen, held_out)


def write_dataset(output, chosen, held_out, recipe=None):
    """Write chosen episodes ({id, path, frames, seed, source, ...}) as one LeRobot v2.1 dataset."""
    manifest = {"status": "pending_provider_validation", "held_out_seeds": held_out, "recipe": recipe,
                "episodes": [{k: str(v) if k == "path" else v for k, v in episode.items()} for episode in chosen],
                "actions": "right then left, six joint targets in radians and normalized gripper per arm",
                "source_fps": FPS, "fps": EXPORT_FPS}
    output.mkdir(parents=True)
    meta = output / "meta"
    meta.mkdir()
    tasks, entries, shapes, frames = {}, [], {}, 0
    for index, episode in enumerate(chosen):
        entry, dimensions = export_episode(output, episode, index, tasks, frames)
        if shapes and shapes != dimensions:
            raise ValueError("All episode camera dimensions must match.")
        shapes = dimensions
        entries.append(entry)
        frames += entry["length"]
    features = {key: {"dtype": "float32", "shape": [14], "names": AXES} for key in ("observation.state", "action")}
    for key in ("timestamp", "frame_index", "episode_index", "index", "task_index", "next.done"):
        dtype = {"timestamp": "float32", "next.done": "bool"}.get(key, "int64")
        features[key] = dict(dtype=dtype, shape=[1], names=None)
    for role, key in CAMERAS.items():
        height, width, channels = shapes[role]
        features[key] = dict(dtype="video", shape=[height, width, channels], names=["height", "width", "channels"],
                             info={"video.fps": EXPORT_FPS, "video.codec": "h264", "video.pix_fmt": "yuv420p",
                                   "video.is_depth_map": False, "has_audio": False})
    count = len(entries)
    info = dict(codebase_version="v2.1", robot_type="yam", total_episodes=count, total_frames=frames,
                total_tasks=len(tasks), total_videos=count * len(CAMERAS), total_chunks=(count + 999) // 1000,
                chunks_size=1000, fps=EXPORT_FPS, splits={"train": f"0:{count}"}, features=features,
                data_path="data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet",
                video_path="videos/chunk-{episode_chunk:03d}/{video_key}/episode_{episode_index:06d}.mp4")
    (meta / "info.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    for name, values in (("tasks", [dict(task_index=i, task=text) for text, i in tasks.items()]), ("episodes", entries)):
        (meta / f"{name}.jsonl").write_text("".join(json.dumps(value) + "\n" for value in values), encoding="utf-8")
    execution.write_atomic(output / ".mission-control.json", json.dumps(manifest, indent=2))


def validate(output):
    from dream.datasets import validate_dataset

    manifest_path = output / ".mission-control.json"
    manifest = execution.read_json(manifest_path)
    report = validate_dataset(str(output), YAM_CONFIG)
    manifest["status"] = "validated" if report.ok else "validation_failed"
    manifest["validation"] = {"ok": report.ok, "message": report.error, "checked_at": execution.now()}
    execution.write_atomic(manifest_path, json.dumps(manifest, indent=2))
    if not report.ok:
        raise ValueError(report.error)


def prepared_datasets():
    root = execution.results_dir() / "datasets"
    return [execution.read_json(path) for path in sorted(root.glob("*/record.json"))]


def workflow(action, payload):
    """Keep local preparation, upload and paid job creation separate."""
    if not isinstance(payload, Mapping):
        raise ValueError("Send dataset settings.")
    root = execution.results_dir() / "datasets"
    try:
        with execution.exclusive("datasets.lock"):
            return dataset_action(root, action, payload)
    except PermissionError as exc:
        raise execution.AdmissionError("Dataset workspace is busy or cannot be written.") from exc


def dataset_action(root, action, payload):
    if action == "prepare":
        selected, held_out = payload.get("episode_ids"), payload.get("held_out_seeds")
        if (not isinstance(selected, list) or not selected or
                any(not isinstance(item, str) or not re.fullmatch(r"[a-f0-9]{32}", item) for item in selected)):
            raise ValueError("Select at least one recorded episode.")
        if not isinstance(held_out, list) or not held_out or any(type(seed) is not int or seed < 0 for seed in held_out):
            raise ValueError("Enter at least one nonnegative seed reserved for evaluation.")
        dataset_id = "yam-" + execution.plans.digest([sorted(selected), sorted(set(held_out))])[:12]
        folder = root / dataset_id
        record_path, data = folder / "record.json", folder / "data"
        if record_path.exists():
            return execution.read_json(record_path)
        if data.exists():
            data.rename(folder / ("failed-" + execution.uuid4().hex[:8]))
        export_dataset(data, selected, held_out)
        validate(data)
        record = dict(id=dataset_id, episodes=len(selected), held_out_seeds=held_out, status="validated")
        execution.write_atomic(record_path, json.dumps(record))
        return record

    dataset_id = payload.get("dataset_id")
    if not isinstance(dataset_id, str) or not re.fullmatch(r"yam-[a-f0-9]{12}", dataset_id):
        raise ValueError("Choose a locally validated dataset.")
    folder = root / dataset_id
    record_path = folder / "record.json"
    record = execution.read_json(record_path)
    if not execution.credential_source():
        raise execution.AdmissionError("Restart with --prompt-key or configure Dream Labs credentials.")

    import dream
    from dream import fine_tuning

    client = dream.DreamClient()

    def save(**changes):
        record.update(changes)
        execution.write_atomic(record_path, json.dumps(record))
        return record

    def apply_remote(dataset):
        return save(remote_id=dataset.id, remote_name=dataset.name, remote_status=dataset.status)

    def apply_job(job):
        return save(job_id=job["id"], job_status=job["status"], checkpoint=job.get("fine_tuned_model"))

    if action == "upload":
        if record.get("remote_id"):
            return apply_remote(client.get_dataset_status(record["remote_id"]))
        embodiment = payload.get("embodiment")
        if not isinstance(embodiment, str) or not re.fullmatch(r"[\w-]+/[\w-]+", embodiment):
            raise ValueError("Enter the Dream Labs YAM embodiment as account/name.")
        existing = [item for item in client.get_datasets() if item.name.endswith("/" + dataset_id)]
        if existing:
            if len(existing) != 1 or existing[0].embodiment != embodiment:
                raise execution.AdmissionError("Check the existing dataset in Dream Labs before uploading.")
            if existing[0].status not in ("failed", "uploading"):
                return apply_remote(existing[0])
        return apply_remote(client.upload_dataset(str(folder / "data"), dataset_id, embodiment))
    if action == "refresh":
        if record.get("remote_id"):
            apply_remote(client.get_dataset_status(record["remote_id"]))
        if record.get("job_id"):
            return apply_job(client.get_finetuning_status(record["job_id"]))
        if record.get("job_started"):
            match = next((item for item in fine_tuning.list() if item.get("dataset") == record.get("remote_name")
                          and item.get("suffix") == dataset_id), None)
            if match:
                return apply_job(match)
        return record
    if action == "train":
        if payload.get("confirm_charge") is not True:
            raise ValueError("Confirm the Dream Labs price and authorize the training job.")
        steps = payload.get("steps")
        if type(steps) is not int or not 500 <= steps <= 10000 or steps % 100:
            raise ValueError("Training steps must be a multiple of 100 between 500 and 10,000.")
        if record.get("job_started"):
            raise execution.AdmissionError("This dataset already has a submission record. Refresh its status before proceeding.")
        if not record.get("remote_id"):
            raise execution.AdmissionError("Upload the dataset first.")
        dataset = client.get_dataset_status(record["remote_id"])
        apply_remote(dataset)
        if dataset.status != "processed":
            raise execution.AdmissionError("Dream Labs must finish processing the dataset before training.")
        save(job_started=execution.now(), job_status="awaiting_confirmation", training_steps=steps)
        try:
            job = client.finetune(dataset.name, dataset_id, steps=steps)
        except dream.DreamServerError as exc:
            if exc.code in ("invalid_request", "payment_required", "not_found"):
                save(job_started=None, job_status="refused")
            raise
        return apply_job(job)
    raise KeyError(action)


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    modes = cli.add_subparsers(dest="mode", required=True)
    modes.add_parser("list")
    export = modes.add_parser("export")
    export.add_argument("output", type=Path)
    export.add_argument("--episode", action="append", required=True)
    export.add_argument("--held-out-seed", action="append", type=int, required=True)
    validate_args = modes.add_parser("validate")
    validate_args.add_argument("output", type=Path)
    args = cli.parse_args()
    try:
        if args.mode == "list":
            print(json.dumps(list_episodes(), indent=2))
        elif args.mode == "export":
            export_dataset(args.output, args.episode, args.held_out_seed)
            print("Exported. Run the official local validation before upload.")
        else:
            validate(args.output)
            print("Dream Labs local validation passed.")
    except (ValueError, OSError, ImportError) as exc:
        cli.exit(1, f"{exc}\n")
