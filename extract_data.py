import requests
import json
import os
from datetime import datetime, timedelta
from git import Repo
import hashlib

# GitHub repo details
GITHUB_REPO_PATH = "/Users/yuangao/Desktop/dev/interview/windborne/windborne_challenge/"
JSON_FOLDER_PATH = os.path.join(GITHUB_REPO_PATH, "data")
INDEX_FILE_PATH = os.path.join(JSON_FOLDER_PATH, "index.json")
GIT_COMMIT_MESSAGE = "Update data"
URL_TEMPLATE = "https://a.windbornesystems.com/treasure/{:02d}.json"

# Ensure data folder exists
os.makedirs(JSON_FOLDER_PATH, exist_ok=True)

def get_file_hash(filepath):
    """ Returns the SHA256 hash of a file """
    if not os.path.exists(filepath):
        return None
    with open(filepath, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()

def scan_local_files():
    """ Scans the local folder for JSON files and returns a sorted list of timestamps """
    files = {}
    now = datetime.now()
    timestamps = []

    for file in os.listdir(JSON_FOLDER_PATH):
        if file.endswith(".json") and file != "index.json":  # Skip index.json itself
            try:
                timestamp_str = file.split(".json")[0]
                timestamp = datetime.strptime(timestamp_str, "%Y%m%d-%H%M")
                timestamps.append(timestamp_str)
                files[timestamp_str] = os.path.join(JSON_FOLDER_PATH, file)
            except ValueError:
                continue

    timestamps.sort(reverse=True)  # Sort latest first
    return files, timestamps

def fetch_json(hour):
    """ Fetches JSON data for a given hour (00-23) and auto-corrects missing brackets. """
    url = URL_TEMPLATE.format(hour)
    try:
        response = requests.get(url)
        response.raise_for_status()
        raw_text = response.text.strip()

        # If the content-type is incorrect, skip parsing
        if "application/json" not in response.headers.get("Content-Type", ""):
            print(f"Skipping non-JSON response for {hour:02d}.json")
            return None

        try:
            return json.loads(raw_text)  # First attempt to parse JSON normally
        except json.JSONDecodeError:
            print(f"Malformed JSON detected for {hour:02d}.json. Attempting to fix...")
            fixed_json = f"[{raw_text}"
            try:
                return json.loads(fixed_json)  # Try parsing the fixed JSON
            except json.JSONDecodeError:
                print(f"Failed to auto-fix JSON for {hour:02d}.json")

        print(f"Failed to parse JSON for {hour:02d}.json after auto-fix attempt.")
        return None

    except requests.exceptions.RequestException as e:
        print(f"Request failed for {hour:02d}.json: {e}")

    return None  # Return None if all attempts fail

def save_json(data, timestamp):
    """ Saves JSON data to file and returns the filepath """
    filename = f"{timestamp}.json"
    filepath = os.path.join(JSON_FOLDER_PATH, filename)

    # Avoid creating duplicate files
    if os.path.exists(filepath):
        print(f"File already exists, skipping: {filename}")
        return filepath

    with open(filepath, "w") as f:
        json.dump(data, f, indent=4)
    return filepath

def update_index_json(timestamps):
    """ Updates index.json with a sorted list of available JSON files """
    with open(INDEX_FILE_PATH, "w") as f:
        json.dump(timestamps, f, indent=4)
    print("Updated index.json")

def process_data():
    """ Main function to fetch, compare, and store JSON files """
    local_files, timestamps = scan_local_files()
    now = datetime.now()
    missing_files = []
    warnings = []
    last_known_hashes = {}

    for hour in range(24):
        json_data = fetch_json(hour)
        if json_data is None:
            missing_files.append(f"{hour:02d}.json")
            continue

        # Compute hash of new data
        new_hash = hashlib.sha256(json.dumps(json_data, sort_keys=True).encode()).hexdigest()

        # Generate the timestamp for this file based on the hour offset
        timestamp = (now - timedelta(hours=hour)).strftime("%Y%m%d-%H%M")

        # Check for duplicates
        duplicate_found = False
        for timestamp_str, filepath in local_files.items():
            old_hash = get_file_hash(filepath)
            if old_hash == new_hash:  # Duplicate found
                duplicate_found = True
                print(f"Duplicate detected for {hour:02d}.json, reusing file: {timestamp_str}.json")
                break

        if not duplicate_found:
            save_path = save_json(json_data, timestamp)
            local_files[timestamp] = save_path  # Update scanned files
            timestamps.append(timestamp)  # Add new file timestamp

            # Check for data change warning
            last_hash = last_known_hashes.get(hour)
            if last_hash and last_hash != new_hash:
                warnings.append(f"WARNING: {hour:02d}.json changed! Previous file: {last_hash}, new file timestamp: {timestamp}")

            last_known_hashes[hour] = new_hash  # Store new hash

    # Update index.json
    timestamps.sort(reverse=True)  # Ensure it's sorted (latest first)
    update_index_json(timestamps)

    if missing_files:
        print("Missing data:", ", ".join(missing_files))
    if warnings:
        print("\n".join(warnings))

    return local_files

def commit_and_push():
    """ Commits and pushes changes if necessary """
    repo = Repo(GITHUB_REPO_PATH)
    repo.git.add(JSON_FOLDER_PATH)

    if repo.is_dirty():
        repo.git.commit("-m", GIT_COMMIT_MESSAGE)
        repo.git.push()
        print("Changes pushed to GitHub.")
    else:
        print("No new changes detected.")

if __name__ == "__main__":
    updated_files = process_data()
    commit_and_push()
