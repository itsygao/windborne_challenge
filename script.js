const map = L.map('map').setView([20, 0], 2); 

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Color palette for different balloons
const COLORS = ["red", "blue", "green", "purple", "orange", "cyan", "magenta", "yellow", "lime", "pink"];
const HTML_PROMPT = "You are generating HTML content strictly within a <p> (paragraph) tag.\nOnly use the following inline HTML tags inside your output: <a>, <strong>, <em>, <span>, <br>, <code>, <mark>, <abbr>, <cite>, <small>, and <u>.\nDo NOT include <meta>, <script>, <style>, <div>, <section>, or any block-level elements.\nExample valid output:\n\n<p>This is an <strong>important</strong> paragraph with a <a href='#'>link</a> and an <em>italic phrase</em>.</p>\n\nAlways ensure the output is fully enclosed within a <p> tag and contains only the allowed tags.\n";

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
                    let real_timestamp = timestamp
                    if (lat === null || isNaN(lat) || lon === null || isNaN(lon) || altitude === null || isNaN(altitude)) {
                        let temp = lastValid?.real_timestamp ?? "NO_VALID_TIME";
                        real_timestamp = real_timestamp + " taken from last valid timestamp " + temp.substring(temp.length - 13, temp.length);
                    }
                    if (lat === null || isNaN(lat)) lat = lastValid?.lat ?? null;
                    if (lon === null || isNaN(lon)) lon = lastValid?.lon ?? null;
                    if (altitude === null || isNaN(altitude)) altitude = lastValid?.altitude ?? null;

                    // If all values are still null, ignore the entry
                    if (lat === null || lon === null || altitude === null) return;

                    // Store latest valid position and timestamp
                    lastValidPositions.set(index, { lat, lon, altitude, real_timestamp });

                    // Add to balloon paths
                    if (!balloonPaths.has(index)) {
                        balloonPaths.set(index, []);
                        balloonDetails.set(index, []);
                    }
                    balloonPaths.get(index).push([lat, lon]);
                    balloonDetails.get(index).push([ lat, lon, altitude, real_timestamp ]);

                    // Add last valid timestamp as an extra entry in the dataset
                    data[index] = [lat, lon, altitude, real_timestamp];
                });

            } catch (error) {
                console.error(`Error processing ${file}:`, error);
            }
        }

        selectAllBalloons(true);

    } catch (error) {
        console.error("Error fetching balloon index:", error);
    }
}

// AI Chat Function (Uses user-provided API key)
let chatHistory = []; // Stores all chat messages
let changedBalloonSelections = true;

async function sendMessage() {
    let apiKey = document.getElementById("api-key").value.trim();
    if (!apiKey) {
        alert("Please enter your OpenAI API key!");
        return;
    }
    if (balloonSelections.size === 0) {
        alert("Please select at least one balloon!");
        return;
    }
    if (balloonSelections.size > 10) {
        alert("Please select no greater than 10 balloons!");
        return;
    }

    let selectedModel = document.getElementById("model-select").value;
    let input = document.getElementById("chat-input").value;
    document.getElementById("chat-log").innerHTML += `<p>You: ${input}</p>`;

    // Only send context in the first message
    if (chatHistory.length === 0) {
        let context = document.getElementById("info-text").innerHTML.replaceAll('<br>', '\n');
        context += "Latitude and longitude follows the geographic coordinate system (GCS), where latitude ranges from -90 to 90 (South to North) and longitude ranges from -180 to 180 (West to East). Balloon altitude is in miles. Timestamp is in Pacific Standard Time.\nIn case you see 'taken from last valid timestamp', it means the balloon was last seen at that time and data between that time and the latest time was missing.\n";
        context += HTML_PROMPT;
        chatHistory.push({ role: "system", content: context });
        console.log("Initial context: " + context);
    } else if (changedBalloonSelections) {
        input = document.getElementById("info-text").innerHTML.replaceAll('<br>', '\n') + input;
        changedBalloonSelections = false;
    }

    // Add user input to chat history
    chatHistory.push({ role: "user", content: input });
    console.log("Prompt: " + input);

    let response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: selectedModel,
            messages: chatHistory  // Send full chat history
        })
    });

    let result = await response.json();
    if (!response.ok) {
        console.error("OpenAI API Error:", result);
        alert(`Error: ${result.error.message}`);
        return;
    }

    let aiMessage = result.choices[0].message.content;
    document.getElementById("chat-log").innerHTML += `<p>AI: ${aiMessage}</p>`;

    // Add AI response to chat history
    chatHistory.push({ role: "assistant", content: aiMessage });
}



loadBalloons();

function createInputBoxes() {
    let inputContainer = document.getElementById("balloon-inputs");
    inputContainer.innerHTML = ""; // Clear old inputs

    for (let i = 0; i < 10; i++) {
        let input = document.createElement("input");
        input.type = "text";
        input.placeholder = `Balloon ${i + 1}`;
        input.oninput = function () {
            this.value = this.value.replace(/[^0-9]/g, ''); // Allow only numbers
        };

        inputContainer.appendChild(input);
    }
}

function clearInputs() {
    document.querySelectorAll("#balloon-inputs input").forEach(input => {
        input.value = ""; // Clear all input fields
    });
    balloonSelections.clear(); // Clear selections
}

function selectAllBalloons(selectAll) {
    balloonSelections.clear();
    
    if (selectAll) {
        // Assume all balloons are selected (Modify the range as needed)
        for (let i = 0; i < balloonPaths.size; i++) {
            balloonSelections.add(i);
        }
    }
    
    updateVisualization();
}

function updateBalloonSelections() {
    balloonSelections.clear();
    document.querySelectorAll("#balloon-inputs input").forEach(input => {
        let val = input.value.trim();
        if (val !== "") {
            balloonSelections.add(parseInt(val));
        }
    });
    
    updateVisualization();
}

function updateVisualization() {
    let infoText = document.getElementById("info-text");
    infoText.innerHTML = "Drawing balloon paths...";
    
    redrawBalloons();
}

function redrawBalloons() {
    // Remove all existing map layers (lines, dots, and markers)
    balloonMarkers.forEach(marker => map.removeLayer(marker));
    balloonMarkers = []; // Reset array

    let selectedPaths = Array.from(balloonSelections).map(i => balloonPaths.get(i));
    let selectedDetails = Array.from(balloonSelections).map(i => balloonDetails.get(i));
    let infoText = document.getElementById("info-text");

    let infoContent = "";
    let selected = Array.from(balloonSelections);

    selectedPaths.forEach((path, index) => {
        if (!path) return;

        let color = COLORS[index % COLORS.length];
        let balloonId = selected[index];

        // Draw path
        let polyline = L.polyline(path, { color: color, weight: 2 }).addTo(map);
        balloonMarkers.push(polyline);

        let history = balloonDetails.get(balloonId);
        if (history) {
            infoContent += `**Balloon ${balloonId} History:**<br>`;
            history.forEach(([lat, lon, altitude, timestamp]) => {
                infoContent += `Lat: ${lat.toFixed(5)}, Lon: ${lon.toFixed(5)}, Altitude: ${altitude.toFixed(2)}, Timestamp: ${timestamp}<br>`;
            });
            infoContent += "<br>";
        }

        // Draw markers for each historical point
        history.forEach(([lat, lon]) => {
            let dot = L.circleMarker([lat, lon], { radius: 3, color: color, fillOpacity: 1 }).addTo(map);
            balloonMarkers.push(dot);
        });

        let latest_data = history[history.length - 1];
        let marker = L.marker([latest_data[0], latest_data[1]]).addTo(map);
        marker.bindPopup(`Balloon ${selected[index]}<br>Lat: ${latest_data[0]}<br>Lon: ${latest_data[1]}<br>Altitude: ${latest_data[2]}<br>Timestamp: ${latest_data[3]}`);
        balloonMarkers.push(marker);
    });

    infoText.innerHTML = selectedPaths.length < 10 ? infoContent || "No balloons selected." : "Too many balloons selected, data hidden.";
}

// Initialize input boxes on page load
document.addEventListener("DOMContentLoaded", createInputBoxes);