from pathlib import Path
import uvicorn
from engine.server import create_app
r=Path(__file__).resolve().parents[1]
uvicorn.run(create_app(r/".local/live-v011",models=r/"models",token="live-test-placeholder",extension_id=(r/"build/extension-id.txt").read_text().strip(),test_mode=True),host="127.0.0.1",port=18771,access_log=False)
