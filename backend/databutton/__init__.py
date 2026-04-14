import os
import json
from pathlib import Path
from typing import Any

# Local `.data` directory to act as the storage store
LOCAL_STORE_DIR = Path(".local_data")
LOCAL_STORE_DIR.mkdir(exist_ok=True)

class StorageJson:
    def get(self, key: str, default: Any = None) -> Any:
        file_path = LOCAL_STORE_DIR / f"{key}.json"
        if not file_path.exists():
            return default
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Mock db error getting {key}: {e}")
            return default

    def put(self, key: str, value: Any) -> None:
        file_path = LOCAL_STORE_DIR / f"{key}.json"
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(value, f, indent=2)
        except Exception as e:
            print(f"Mock db error putting {key}: {e}")

    def delete(self, key: str) -> None:
        file_path = LOCAL_STORE_DIR / f"{key}.json"
        if file_path.exists():
            try:
                os.remove(file_path)
            except Exception as e:
                print(f"Mock db error deleting {key}: {e}")

    def list(self) -> list:
        class Entry:
            def __init__(self, name):
                self.name = name
                
        entries = []
        for file_path in LOCAL_STORE_DIR.glob("*.json"):
            # strip .json extension for key
            entries.append(Entry(file_path.stem))
        return entries

class Storage:
    def __init__(self):
        self.json = StorageJson()

class Secrets:
    def get(self, key: str, default: Any = None) -> Any:
        # Load from environment variables (like .env)
        return os.environ.get(key, default)

class Notify:
    def email(self, to: str, subject: str, content_html: str = "", content_text: str = "") -> None:
        print(f"========== MOCK EMAIL ==========")
        print(f"TO: {to}")
        print(f"SUBJECT: {subject}")
        print(f"CONTENT:\n{content_text}")
        print(f"================================")

# Instantiate the mocks so they can be accessed as attributes
storage = Storage()
secrets = Secrets()
notify = Notify()
