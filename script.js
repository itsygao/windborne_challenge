const map = L.map('map').setView([20, 0], 2); 

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Color palette for different balloons
const COLORS = ["red", "blue", "green", "purple", "orange", "cyan", "magenta", "yellow", "lime", "pink"];

let balloonSelections = new Set(); // Stores selected balloon indices
let balloonPaths = new Map(); // Stores paths by index
let balloonDetails = new Map();
let balloonMarkers = []; // Store plotted points
let lastValidPositions = new Map(); // Stores last known valid positions

// Get the latest balloon data (last 24 hours)
async function loadBalloons() {
    const balloonsFolder = "https://itsygao.github.io/windborne_challenge/data/";
    const indexFile = balloonsFolder + "index.json";
    balloonPaths.clear();
    lastValidPositions.clear();

    try {
        // Fetch the list of available JSON files
        let response = await fetch(indexFile);
        if (!response.ok) {
            console.error("Failed to fetch file list.");
            return;
        }

        let fileList = await response.json();

        // Sort files in ascending order (oldest first) so newer files can reuse valid values
        fileList.sort(); 
        let latestFiles = fileList.slice(Math.max(0, fileList.length - 24)); // Get last 24 files

        let balloonCount = null; // Stores expected number of balloons

        for (let file of latestFiles) {
            let url = balloonsFolder + file + ".json";
            let timestamp = file.replace(".json", ""); // Extract timestamp from filename

            try {
                let balloonResponse = await fetch(url);
                if (!balloonResponse.ok) {
                    console.warn(`Skipping file ${file} due to fetch error.`);
                    continue;
                }

                let rawText = await balloonResponse.text();

                // Handle NaN values before parsing JSON
                rawText = rawText.replace(/\bNaN\b/g, "null");

                let data;
                try {
                    data = JSON.parse(rawText); // Parse the cleaned JSON
                } catch (jsonError) {
                    console.error(`Failed to parse JSON from ${file}:`, jsonError);
                    continue;
                }

                // Ensure data is a valid array
                if (!Array.isArray(data)) {
                    console.warn(`Skipping file ${file} due to unexpected format.`);
                    continue;
                }

                // Check for consistent balloon count
                if (balloonCount === null) {
                    balloonCount = data.length; // Set expected count on first file
                } else if (data.length !== balloonCount) {
                    console.warn(`File ${file} has ${data.length} balloons, expected ${balloonCount}!`);
                    continue; // Skip inconsistent file
                }

                // Process each balloon
                data.forEach((balloon, index) => {
                    if (!Array.isArray(balloon) || balloon.length < 3) return; // Ignore malformed data
                    let [lat, lon, altitude] = balloon;

                    // Handle invalid data by using previous values if available
                    let lastValid = lastValidPositions.get(index);
                    if (lat === null || isNaN(lat)) lat = lastValid?.lat ?? null;
                    if (lon === null || isNaN(lon)) lon = lastValid?.lon ?? null;
                    if (altitude === null || isNaN(altitude)) altitude = lastValid?.altitude ?? null;

                    // If all values are still null, ignore the entry
                    if (lat === null || lon === null || altitude === null) return;

                    // Store latest valid position and timestamp
                    lastValidPositions.set(index, { lat, lon, altitude, timestamp });

                    // Add to balloon paths
                    if (!balloonPaths.has(index)) {
                        balloonPaths.set(index, []);
                        balloonDetails.set(index, []);
                    }
                    balloonPaths.get(index).push([lat, lon]);
                    balloonDetails.get(index).push([ lat, lon, altitude, timestamp ]);

                    // Add last valid timestamp as an extra entry in the dataset
                    data[index] = [lat, lon, altitude, timestamp];
                });

            } catch (error) {
                console.error(`Error processing ${file}:`, error);
            }
        }

        createCheckboxes(balloonCount);
        selectAllBalloons(true);

    } catch (error) {
        console.error("Error fetching balloon index:", error);
    }
}

// AI Chat Function (Uses user-provided API key)
async function sendMessage() {
    let apiKey = document.getElementById("api-key").value.trim();
    if (!apiKey) {
        alert("Please enter your OpenAI API key!");
        return;
    }

    let input = document.getElementById("chat-input").value;
    document.getElementById("chat-log").innerHTML += `<p>You: ${input}</p>`;

    let response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: "gpt-4",
            messages: [{ role: "user", content: input }]
        })
    });

    let result = await response.json();
    document.getElementById("chat-log").innerHTML += `<p>AI: ${result.choices[0].message.content}</p>`;
}

loadBalloons();

function createCheckboxes(balloonCount) {
    let checkboxContainer = document.getElementById("balloon-checkboxes");
    checkboxContainer.innerHTML = ""; // Clear old checkboxes

    for (let i = 0; i < balloonCount; i++) {
        let checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = true;
        checkbox.value = i;
        // checkbox.onchange = () => updateVisualization();

        let label = document.createElement("label");
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(`Balloon ${i}`));

        checkboxContainer.appendChild(label);
    }
}

function selectAllBalloons(selectAll) {
    balloonSelections.clear();
    document.querySelectorAll("#balloon-checkboxes input").forEach(cb => {
        cb.checked = selectAll;
        if (selectAll) balloonSelections.add(parseInt(cb.value));
    });
    // updateVisualization();
}

function updateVisualization() {
    let infoText = document.getElementById("info-text");
    infoText.innerHTML = "Drawing balloon paths...";
    balloonSelections.clear();
    document.querySelectorAll("#balloon-checkboxes input:checked").forEach(cb => {
        balloonSelections.add(parseInt(cb.value));
    });
    redrawBalloons()

    console.log("Balloon selections updated. Click Replot to update visualization.");
}

function redrawBalloons() {
    // Remove all existing map layers (lines, dots, and markers)
    balloonMarkers.forEach(marker => map.removeLayer(marker));
    balloonMarkers = []; // Reset array

    let selectedPaths = Array.from(balloonSelections).map(i => balloonPaths.get(i));
    let selectedDetails = Array.from(balloonSelections).map(i => balloonDetails.get(i));
    let infoText = document.getElementById("info-text"); // Get the info display area

    let infoContent = ""; // Store the information text
    let selected = Array.from(balloonSelections);

    selectedPaths.forEach((path, index) => {
        if (!path) return;

        let color = COLORS[index % COLORS.length];
        let balloonId = selected[index];

        // Draw path
        let polyline = L.polyline(path, { color: color, weight: 2 }).addTo(map);
        balloonMarkers.push(polyline);

        // Ensure historical details exist before displaying them
        let history = balloonDetails.get(balloonId);
        if (history) {
            infoContent += `<strong>Balloon ${balloonId} History:</strong><br>`;

            history.forEach(([lat, lon, altitude, timestamp]) => {
                infoContent += `Lat: ${lat}, Lon: ${lon}, Altitude: ${altitude}, Timestamp: ${timestamp}<br>`;
            });

            infoContent += "<br>"; // Add space between different balloons
        }

        // Draw markers for each historical point
        history.forEach(([lat, lon]) => {
            let dot = L.circleMarker([lat, lon], { radius: 3, color: color, fillOpacity: 1 }).addTo(map);
            balloonMarkers.push(dot);
        });
    });

    // Update the UI with selected paths info
    if (selectedPaths.length < 10) {
        infoText.innerHTML = infoContent || "No balloons selected.";
    } else {
        infoText.innerHTML = "Too many balloons selected, data hidden.";
    }
}
