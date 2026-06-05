import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

async function run() {
  console.log("Checking GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "Defined" : "Undefined");
  if (!process.env.GEMINI_API_KEY) return;

  try {
    console.log("Testing gemini-2.5-flash-image...");
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [{ text: "A cute little cat sleeping on a sunny windowsill, high-quality photograph" }]
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1"
        }
      }
    });

    console.log("Success with gemini-2.5-flash-image!");
    for (const part of res.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        console.log("Found image: length =", part.inlineData.data?.length);
      } else if (part.text) {
        console.log("Found text:", part.text);
      }
    }
  } catch (err: any) {
    console.error("Failed with gemini-2.5-flash-image:", err.message);
  }

  try {
    console.log("\nTesting imagen-4.0-generate-001...");
    const res = await ai.models.generateImages({
      model: "imagen-4.0-generate-001",
      prompt: "A cute little cat sleeping on a sunny windowsill, high-quality photograph",
      config: {
        numberOfImages: 1,
        outputMimeType: "image/jpeg",
        aspectRatio: "1:1"
      }
    });
    console.log("Success with imagen-4.0-generate-001!");
    if (res.generatedImages?.[0]?.image?.imageBytes) {
      console.log("Image length:", res.generatedImages[0].image.imageBytes.length);
    }
  } catch (err: any) {
    console.error("Failed with imagen-4.0-generate-001:", err.message);
  }
}

run();
