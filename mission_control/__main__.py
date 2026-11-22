"""Serve the YAM Simulation Console with python -m mission_control."""
import argparse
import getpass
import json
import mimetypes
import os
import re
import shutil
import threading
import warnings
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from . import datasets, execution, ladder, plans
from .catalog import Catalog, metrics


WEB = Path(__file__).with_name("web")
CACHE_LOCK = threading.Lock()
snapshot = None
signature = None


def catalog():
    global snapshot, signature
    runs = execution.results_dir()
    with CACHE_LOCK:
        stamp = tuple((p, p.stat().st_mtime_ns, p.stat().st_size)
                      for p in sorted(runs.glob("mc-*/results.jsonl")))
        if snapshot is None or stamp != signature:
            snapshot = Catalog(runs)
            signature = stamp
        return snapshot


def experiments(c):
    groups = {}
    for job in execution.jobs():
        jid, cfg = job["id"],job["config"]
        task = next(t for t in execution.tasks() if t["id"]==cfg["task_id"])
        results = c.by_run.get(jid, dict(metrics=metrics([]), trial_ids=[]))
        saved = execution.read_json(execution.run_dir(jid) / "config.json")
        groups[jid] = {**results, **cfg, **{k:job[k] for k in ("status","current_seed","completed","errors","created_at","updated_at","message") if k in job},
                       "id":jid,"run":jid,"task":task["target"],"target":task["target"],"goal":task["goal"],
                       "mode":"oracle" if cfg["model"] == "oracle" else "plain",
                       "source": "Scripted simulator" if cfg["model"] == "oracle" else "Dream-1 · live simulation",
                       "planned":cfg["trials"],"name":task["label"],
                       "plan":saved.get("plan"),"parent_id":saved.get("parent_id"),"sequence":saved.get("sequence")}
    return groups


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def headers_for(self,status,kind,size,download=False):
        self.send_response(status)
        self.send_header("Content-Type",kind)
        self.send_header("Content-Length",str(size))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Referrer-Policy","no-referrer")
        self.send_header("Content-Security-Policy","default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'")
        if download:
            self.send_header("Content-Disposition",'attachment; filename="simulation-results.jsonl"')
        self.end_headers()

    def respond(self,data,status=200,download=False):
        body=json.dumps(data,ensure_ascii=False,allow_nan=False).encode()
        self.headers_for(status,"application/json; charset=utf-8",len(body),download)
        self.wfile.write(body)

    def file(self,path,download=False):
        types = {".ttf":"font/ttf", ".jsonl":"application/x-ndjson", ".mp4":"video/mp4"}
        kind = types.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        size = path.stat().st_size
        wanted = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        with path.open("rb") as f:
            if not wanted or not (wanted[1] or wanted[2]):
                self.headers_for(200,kind,size,download)
                return shutil.copyfileobj(f,self.wfile)
            # Byte ranges let the browser seek inside a video.
            if wanted[1]:
                start = int(wanted[1])
                end = min(int(wanted[2]), size - 1) if wanted[2] else size - 1
            else:
                start, end = max(size - int(wanted[2]), 0), size - 1
            if start > end or start >= size:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                return self.end_headers()
            self.send_response(206)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            f.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = f.read(min(remaining, 1 << 16))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def dispatch(self):
        hosts = {f"127.0.0.1:{self.server.server_port}",f"localhost:{self.server.server_port}"}
        if self.headers.get("Host") not in hosts:
            return self.respond({"error":"Use the dashboard's local address."},403)
        url=urlsplit(self.path)
        path=url.path
        if self.command=="POST":
            origin=self.headers.get("Origin")
            if origin and origin not in {"http://"+h for h in hosts}:
                return self.respond({"error":"Open the local dashboard to start an experiment."},403)
            if self.headers.get_content_type()!="application/json":
                return self.respond({"error":"Send JSON."},415)
            size=int(self.headers.get("Content-Length","0"))
            if not 0<size<=8192:
                return self.respond({"error":"Invalid request size."},413)
            try:
                data=json.loads(self.rfile.read(size))
            except (UnicodeError,ValueError):
                raise ValueError("Send a valid JSON object.") from None
            if path=="/api/plans/preview":
                return self.respond(execution.preview(data))
            if path=="/api/preflight":
                return self.respond(execution.preflight(data))
            for action in ("prepare", "upload", "refresh", "train"):
                if path == f"/api/datasets/{action}":
                    try:
                        return self.respond(datasets.workflow(action, data))
                    except ImportError as exc:
                        raise execution.AdmissionError("Install the Dream Labs client with its datasets extra.") from exc
                    except Exception as exc:
                        if type(exc).__module__.startswith("dream."):
                            return self.respond({"error":"Dream Labs request did not complete. Check the platform and refresh status before retrying.",
                                                 "code":getattr(exc, "code", "provider_error")}, 502)
                        raise
            if path=="/api/experiments":
                if isinstance(data, dict) and data.get("parent_id"):
                    parent_id = data["parent_id"]
                    if not isinstance(parent_id, str):
                        raise plans.InvalidPlan("Choose a valid parent experiment.", "parent_id")
                    index = catalog()
                    parent = experiments(index)[parent_id]
                    seeds = parent.get("seeds") or sorted(index.trials[tid]["seed"] for tid in parent["trial_ids"])
                    if execution.validate_config(data.get("config"))["seeds"] != seeds:
                        raise plans.InvalidPlan("A cloned experiment must keep its parent's seed manifest.", "seeds")
                return self.respond(execution.start(data),201)
            parts=path.strip("/").split("/")
            if len(parts)==4 and parts[:2]==["api","experiments"]:
                if parts[3]=="cancel":
                    return self.respond(execution.cancel(parts[2]))
                if parts[3]=="resume":
                    return self.respond(execution.resume(parts[2]))
            raise KeyError
        static={"/":"index.html","/app.js":"app.js","/style.css":"style.css"}
        if path in static:
            return self.file(WEB/static[path])
        if path=="/api/health":
            return self.respond({"missing_dependencies":execution.missing_simulator_dependencies()})
        if path=="/api/budget":
            return self.respond(execution.budget())
        if path in ("/api/tasks", "/api/catalog"):
            return self.respond({"tasks":execution.tasks(),"models":[execution.BASE_MODEL,"oracle"],
                                 "defaults":execution.validate_config({}),"budget":execution.budget()})
        if path=="/api/ladder":
            folders = sorted(p for p in ladder.root().glob("*") if (p / "results.jsonl").is_file())
            return self.respond({"collections":[p.name for p in folders]})
        if path.startswith("/api/ladder/"):
            name = path.removeprefix("/api/ladder/")
            folder = ladder.root() / name
            if not re.fullmatch(r"[\w-]+", name) or not (folder / "results.jsonl").is_file():
                raise KeyError
            rows = ladder.latest(ladder.read_rows(folder))
            keep = ("trial_id","level","arm","seed","outcome","success","progress","progress_of","calls","rows",
                    "step_outcomes","clean","steering","video","model","actions","median_rtt_s","est_cost_usd","error")
            return self.respond({"name":name,"summary":ladder.summarize(rows),
                                 "trials":[{k:r.get(k) for k in keep} for r in rows]})
        if path.startswith("/ladder-media/"):
            name, _, trial = path.removeprefix("/ladder-media/").partition("/")
            if not re.fullmatch(r"[\w-]+", name) or not re.fullmatch(r"[\w-]+", trial):
                raise KeyError
            return self.file(ladder.root() / name / "video" / f"{trial}.mp4")
        if path=="/api/datasets":
            return self.respond({"episodes":datasets.list_episodes(), "prepared":datasets.prepared_datasets(),
                                 "credentials_present":bool(execution.credential_source())})
        c=catalog()
        if path.startswith("/media/"):
            return self.file(c.media[path.removeprefix("/media/")])
        if path in ("/api/compare", "/api/comparison"):
            q=parse_qs(url.query)
            return self.respond(c.compare((q.get("baseline") or q["a"])[0],
                                          (q.get("candidate") or q["b"])[0], experiments(c)))
        if path.startswith("/api/trials/"):
            return self.respond(c.trials[path.removeprefix("/api/trials/")])
        groups=experiments(c)
        if path=="/api/experiments":
            q=parse_qs(url.query)
            entries = [group for group in groups.values() if all(
                key not in q or str(group.get(key)) in q[key] for key in ("task", "source", "status"))]
            offset, limit = int(q.get("offset", [0])[0]), int(q.get("limit", [1000])[0])
            if offset < 0 or not 1 <= limit <= 1000:
                raise ValueError("Choose a valid pagination range.")
            return self.respond({"experiments":entries[offset:offset+limit],"total":len(entries)})
        if path=="/api/results":
            return self.respond({"trials":[trial for trial in c.trials.values() if trial["experiment_id"] in groups]})
        parts=path.strip("/").split("/")
        if len(parts) in (3,4) and parts[:2]==["api","experiments"]:
            g=groups[parts[2]]
            if len(parts)==3:
                if g["id"].startswith("mc-"):
                    job = execution.progress(execution.status(g["id"]))
                    by_seed = {c.trials[key]["seed"]: c.trials[key] for key in g["trial_ids"]}
                    g = {**g, **{k:job.get(k) for k in ("active_attempt","live","events")},
                         "slots":[dict(seed=seed, id=by_seed.get(seed, {}).get("id"),
                                       status=by_seed.get(seed, {}).get("status") or
                                       ("running" if seed == job.get("current_seed") else
                                         "cancelled" if job["status"] == "cancelled" else "pending"))
                                  for seed in g.get("seeds", [])]}
                return self.respond(g)
            trials=[c.trials[i] for i in g["trial_ids"]]
            if parts[3]=="trials":
                return self.respond({"trials":trials})
            if parts[3]=="export":
                return self.file(execution.run_dir(g["id"]) / "results.jsonl", download=True)
        raise KeyError

    def do_GET(self):
        try:
            self.dispatch()
        except (KeyError,FileNotFoundError):
            self.respond({"error":"No matching local record or file."},404)
        except execution.AdmissionError as exc:
            self.respond({"error":str(exc),"code":"admission_blocked","recovery":"Review simulator requirements or revise run settings."},409)
        except plans.InvalidPlan as exc:
            self.respond({"error":str(exc),"code":"invalid_field","fields":{exc.field:str(exc)}},422)
        except ValueError as exc:
            self.respond({"error":str(exc),"code":"invalid_request"},422)
        except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):
            pass
        except Exception:
            self.respond({"error":"Unable to read or update this experiment. Check local storage and runner setup."},500)

    do_POST=do_GET


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port",type=int,default=8765)
    parser.add_argument("--prompt-key",action="store_true",help="Read an existing Dream API key without echo or saving it")
    args=parser.parse_args()
    if args.prompt_key:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("error",getpass.GetPassWarning)
                key=getpass.getpass("Dream API key: ").strip()
        except (EOFError,KeyboardInterrupt,getpass.GetPassWarning):
            parser.exit(1,"Use an interactive terminal with hidden input.\n")
        if not key or any(ch.isspace() for ch in key):
            parser.error("Enter a nonempty key without whitespace.")
        os.environ["DREAM_API_KEY"] = key
        del key
    try:
        with execution.exclusive("coordinator.lock"), ThreadingHTTPServer(("127.0.0.1",args.port),Handler) as server:
            execution.recover()
            print(f"YAM Simulation Console: http://127.0.0.1:{server.server_port}",flush=True)
            server.serve_forever()
    except KeyboardInterrupt:
        pass
    except OSError as exc:
        parser.exit(1, f"Could not start the local coordinator: {exc}\n")
