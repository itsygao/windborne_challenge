const map = L.map('map').setView([20, 0], 2); 

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Color palette for different balloons
const COLORS = ["red", "blue", "green", "purple", "orange", "cyan", "magenta", "yellow", "lime", "pink"];

let balloonSelections = new Set(); // Stores selected balloon indices
let balloonPaths = new Map(); // Stores paths by index
let balloonMarkers = []; // Store plotted points
let lastValidPositions = new Map(); // Stores last known valid positions

// Get the latest balloon data (last 24 hours)
async function loadBalloons() {
    const now = new Date();
    const balloonsFolder = "https://itsygao.github.io/windborne_challenge/data/";
    const indexFile = balloonsFolder + "index.json";
    balloonPaths.clear();

    try {
        // Fetch the list of available JSON files
        let response = await fetch(indexFile);
        if (!response.ok) {
            console.error("Failed to fetch file list.");
            return;
        }
        
        let fileList = await response.json();

        // Sort files in descending order (latest first) and select at most 24
        fileList.sort().reverse();
        let latestFiles = fileList.slice(0, 24);


        // Fetch and process balloon data
        let balloonCount = null; // Stores the expected number of balloons
        // let balloonPaths = new Map(); // Stores paths by index
        // let lastValidPositions = new Map(); // Stores last known valid positions

        for (let file of latestFiles) {
            let url = balloonsFolder + file + ".json";
            let timestamp = file.replace(".json", ""); // Extract timestamp from filename

            try {
                let balloonResponse = await fetch(url);
                if (!balloonResponse.ok) {
                    console.warn(`Skipping file ${file} due to fetch error.`);
                    continue;
                }

                let rawText = await balloonResponse.text(); // Read raw response first
                let data;

                try {
                    data = JSON.parse(rawText); // Safely parse JSON
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

                // Process each balloon by its index
                data.forEach((balloon, index) => {
                    if (!Array.isArray(balloon) || balloon.length < 3) return; // Ignore malformed data
                    let [lat, lon, altitude] = balloon;

                    // If data is completely invalid, keep previous location if available
                    if (isNaN(lat) || isNaN(lon) || isNaN(altitude)) {
                        if (lastValidPositions.has(index)) {
                            let { lat: prevLat, lon: prevLon } = lastValidPositions.get(index);
                            lat = prevLat;
                            lon = prevLon;
                        } else {
                            return; // No valid previous position, ignore balloon
                        }
                    }

                    // Store latest valid position
                    lastValidPositions.set(index, { lat, lon, altitude, timestamp });

                    // Add to balloon paths
                    if (!balloonPaths.has(index)) {
                        balloonPaths.set(index, []);
                    }
                    balloonPaths.get(index).push([lat, lon]);
                });

            } catch (error) {
                console.error(`Error processing ${file}:`, error);
            }
        }

        createCheckboxes(balloonCount);
        selectAllBalloons(true);

        // Draw balloon paths and add latest markers
        // let colorIndex = 0;
        // balloonPaths.forEach((path, id) => {
        //     if (path.length < 2) return;  // Skip if not enough data points
            
        //     let color = COLORS[colorIndex % COLORS.length];
        //     colorIndex++;

        //     // Draw the path
        //     L.polyline(path, { color: color, weight: 2 }).addTo(map);

        //     // Add marker only for the latest position
        //     let latestPos = [lastValidPositions.get(id).lat, lastValidPositions.get(id).lon, lastValidPositions.get(id).altitude, lastValidPositions.get(id).timestamp];
        //     let marker = L.marker([latestPos[0], latestPos[1]]).addTo(map);
        //     marker.bindPopup(`Balloon ${id}<br>Lat: ${latestPos[0]}<br>Lon: ${latestPos[1]}<br>Altitude: ${latestPos[2]}<br>timestamp: ${latestPos[3]}`).openPopup();
        // });

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
        checkbox.onchange = () => updateVisualization();

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
    let infoText = document.getElementById("info-text"); // Get the info display area

    let infoContent = ""; // Store the information text

    selectedPaths.forEach((path, index) => {
        if (!path) return;

        let color = COLORS[index % COLORS.length];

        // Draw path
        let polyline = L.polyline(path, { color: color, weight: 2 }).addTo(map);
        balloonMarkers.push(polyline);

        // Ensure latest position is valid before creating marker
        let latest = lastValidPositions.get(index);
        if (latest) {
            let { lat, lon, altitude, timestamp } = latest;
            let marker = L.marker([lat, lon]).addTo(map);
            marker.bindPopup(`Balloon ${index}<br>Lat: ${lat}<br>Lon: ${lon}<br>Altitude: ${altitude}<br>Timestamp: ${timestamp}`);

            balloonMarkers.push(marker); // Store marker for future removal

            // Add to info display
            infoContent += `Balloon ${index}: Lat ${lat}, Lon ${lon}, Altitude ${altitude}, Timestamp ${timestamp}<br>`;
        }

        // Draw dots for each location
        path.forEach(([lat, lon]) => {
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
