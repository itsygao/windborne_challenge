import requests
import json
import os
from datetime import datetime
from git import Repo

# GitHub repo details
GITHUB_REPO_PATH = "/Users/yuangao/Desktop/dev/interview/windborne/windborne_challenge/"
JSON_FOLDER_PATH = os.path.join(GITHUB_REPO_PATH, "data")
JSON_FILE_PATH = os.path.join(JSON_FOLDER_PATH, f"{datetime.now().strftime('%Y%m%d-%H%M')}.json")
GIT_COMMIT_MESSAGE = "Update data"

# URL to fetch data from
URL = "https://a.windbornesystems.com/treasure/00.json"

def fetch_and_save_json():
    try:
        response = requests.get(URL)
        response.raise_for_status()
        data = response.json()

        # Save JSON to file
        with open(JSON_FILE_PATH, "w") as f:
            json.dump(data, f, indent=4)

        print(f"JSON updated at {datetime.now()}")
        return True

    except Exception as e:
        print(f"Error fetching JSON: {e}")
        return False

def commit_and_push():
    repo = Repo(GITHUB_REPO_PATH)
    repo.git.add(JSON_FILE_PATH)
    if repo.is_dirty():
        repo.git.commit("-m", GIT_COMMIT_MESSAGE)
        repo.git.push()
        print("Changes pushed to GitHub.")
    else:
        print("No changes detected.")

if __name__ == "__main__":
    if fetch_and_save_json():
        commit_and_push()
