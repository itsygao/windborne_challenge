const map = L.map('map').setView([20, 0], 2); 

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

// Get the latest balloon data (last 24 hours)
async function loadBalloons() {
    const now = new Date();
    const balloonsFolder = "https://your-username.github.io/windborne_challenge/data/";
    const indexFile = balloonsFolder + "index.json";

    try {
        // Fetch the list of available JSON files
        let response = await fetch(indexFile);
        if (!response.ok) {
            console.error("Failed to fetch file list.");
            return;
        }
        
        let fileList = await response.json();

        // Sort files in descending order (latest first) and select at most 72
        fileList.sort().reverse();
        let latestFiles = fileList.slice(0, 72);

        // Fetch and load balloon data from each selected file
        for (let file of latestFiles) {
            let url = balloonsFolder + file + ".json";
            try {
                let balloonResponse = await fetch(url);
                if (!balloonResponse.ok) continue;

                let data = await balloonResponse.json();
                data.forEach(balloon => {
                    let marker = L.marker([balloon[0], balloon[1]]).addTo(map);
                    marker.bindPopup(`Altitude: ${balloon[2]} km`);
                });

            } catch (error) {
                console.error(`Error loading ${file}:`, error);
            }
        }

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
