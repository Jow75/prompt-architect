import fetch from "node-fetch";

async function run() {
  try {
    const prompt = "A beautiful futuristic city, cinematic photography";
    const url = "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell";
    console.log("Fetching from Hugging Face:", url);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ inputs: prompt })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP error! status: ${res.status}, body: ${text}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    console.log("Success! Received image from Hugging Face! Buffer size:", buffer.length);
    console.log("Base64 start:", buffer.toString("base64").substring(0, 100));
  } catch (err: any) {
    console.error("Hugging Face error:", err.message);
  }
}

run();
