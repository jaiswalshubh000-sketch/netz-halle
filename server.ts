import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { CanonicalData } from "./src/canonical/types";
import { validateCanonicalData } from "./src/validate";
import { WebSocketServer } from "ws";
import * as http from "http";

const app = express();
const PORT = 3000;

app.use(express.json());

const clients: express.Response[] = [];

app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.push(res);
  req.on('close', () => {
    const index = clients.indexOf(res);
    if (index !== -1) clients.splice(index, 1);
  });
});

app.post('/api/webhook/incoming', (req, res) => {
  const { text, source_channel } = req.body;
  if (!text) return res.status(400).json({ error: "No text provided" });
  const payload = JSON.stringify({ text, source_channel: source_channel || 'sms' });
  clients.forEach(client => client.write(`data: ${payload}\n\n`));
  res.json({ success: true });
});

// Fake/Mock Parsed Output
const mockParseResult: CanonicalData = {
  source_channel: "email",
  sentiment: "neutral",
  applicant: {
    firstName: "Max",
    lastName: "Mustermann",
    email: "max@example.com",
    phone: null,
  },
  location: {
    street: "Musterstraße 1",
    zipCode: "12345",
    city: "Musterstadt",
  },
  technical: {
    powerKw: 15.5,
    isPvSystem: true,
  },
  financial: {
    iban: null,
  },
  missing_mandatory_fields: [],
};

app.post("/api/parse", async (req, res) => {
  try {
    const { text, source_channel } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.log("No GEMINI_API_KEY found, using fallback parser.");
      // Apply validation to mock data
      const validated = validateCanonicalData(mockParseResult);
      mockParseResult.missing_mandatory_fields = validated.missing;
      // return mock
      return res.json({ parsed: mockParseResult });
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const prompt = `You are an expert data extraction system for a German power grid operator.
Your task is to analyze unstructured incoming communications regarding new Grid Connections (Netzanschluss) for PV systems (up to 30 kW).

Extract the relevant information and output STRICTLY valid JSON matching the canonical schema. Do not include markdown formatting, explanations, or any text outside the JSON object.

# INSTRUCTIONS:
1. Identify the applicant's details (Name, Address, Contact Info).
2. Identify technical details (Power in kW, existing connection status).
3. Identify financial details (IBAN).
4. If a mandatory field is missing in the text, return null for that field.
5. Analyze the sentiment of the message (e.g., "neutral", "frustrated", "urgent").

# EXPECTED JSON SCHEMA:
{
  "source_channel": "email | fax | letter | phone_call | sms",
  "sentiment": "string",
  "applicant": {
    "firstName": "string | null",
    "lastName": "string | null",
    "email": "string | null",
    "phone": "string | null"
  },
  "location": {
    "street": "string | null",
    "zipCode": "string | null",
    "city": "string | null"
  },
  "technical": {
    "powerKw": "number | null",
    "isPvSystem": "boolean"
  },
  "financial": {
    "iban": "string | null"
  },
  "missing_mandatory_fields": []
}

The message text is:
"""
${text}
"""
`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("No text returned from Gemini");
    }

    let parsed: CanonicalData;
    try {
      parsed = JSON.parse(resultText) as CanonicalData;
    } catch (e) {
      console.error("Failed to parse JSON from Gemini", resultText);
      return res.status(500).json({ error: "Invalid JSON from AI model" });
    }

    // Force source channel if provided
    if (source_channel && !parsed.source_channel) {
      parsed.source_channel = source_channel;
    }

    // Perform completeness validation
    const validation = validateCanonicalData(parsed);
    parsed.missing_mandatory_fields = validation.missing;

    res.json({ parsed });

  } catch (error: any) {
    console.error("Error in /api/parse", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});

async function startServer() {
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/live' });

  wss.on("connection", async (clientWs, request) => {
    try {
      const url = new URL(request.url!, `http://localhost`);
      const missingFields = url.searchParams.get("missingFields");
      const name = url.searchParams.get("name") || "Customer";

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.error("No GEMINI_API_KEY available for Live API");
        clientWs.close();
        return;
      }
      
      let systemInstruction = `You are an AI assistant for a German power grid operator "EVH". 
Your task is to take phone calls from customers wanting to register their PV systems (solar panels).
Be friendly, professional, and helpful. Ask them for the required missing information step-by-step:
1. First and last name.
2. Address (Street, ZIP code, City).
3. The installed power of the PV system in kWp.
Instead of asking for their IBAN, tell them they will receive a secure form via email or SMS to upload their bank info.
Only ask one thing at a time to not overwhelm them. When you have gathered the required information, you MUST call the update_application_data function to save it.`;

      if (missingFields) {
        systemInstruction = `You are an AI voice assistant calling back a customer named ${name} on behalf of the German power grid operator "EVH" regarding their PV system registration.
Their application is incomplete. You need to ask them for the following missing information: ${missingFields}.
If IBAN is missing, DO NOT ask for it. Instead, inform them they will receive a secure link via email/SMS to submit their bank info.
Be friendly, professional, and ask for the missing items one by one. Do not overwhelm them. Acknowledge when they provide a piece of information. When you have gathered the required information, you MUST call the update_application_data function to save it.`;
      }

      const ai = new GoogleGenAI({ apiKey });
      const session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
          },
          systemInstruction,
          tools: [{
            functionDeclarations: [{
              name: "update_application_data",
              description: "Update the user's PV application data with newly provided information.",
              parameters: {
                type: "OBJECT",
                properties: {
                  firstName: { type: "STRING" },
                  lastName: { type: "STRING" },
                  email: { type: "STRING" },
                  phone: { type: "STRING" },
                  street: { type: "STRING" },
                  zipCode: { type: "STRING" },
                  city: { type: "STRING" },
                  powerKw: { type: "NUMBER" },
                  iban: { type: "STRING" }
                }
              }
            }]
          }]
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
                }
              }
            }
            if (message.serverContent?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }
            if (message.toolCall) {
              const call = message.toolCall.functionCalls?.[0];
              if (call && call.name === "update_application_data") {
                const args = call.args;
                clientWs.send(JSON.stringify({ updateData: args }));
                
                session.sendToolResponse({
                  functionResponses: [{
                    id: call.id,
                    name: call.name,
                    response: { result: "Success, data updated" }
                  }]
                });
              }
            }
          },
        },
      });

      // Send initial message so the AI speaks first
      await session.sendClientContent({
        turns: [{ role: "user", parts: [{ text: "Hello, please start the conversation." }] }],
        turnComplete: true,
      });

      clientWs.on("message", (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (parsed.audio) {
            session.sendRealtimeInput({
              audio: { data: parsed.audio, mimeType: "audio/pcm;rate=16000" },
            });
          }
        } catch (err) {
          console.error("Error parsing WS message:", err);
        }
      });

      clientWs.on("close", () => {
        session.close();
      });

    } catch (error) {
      console.error("Error setting up live API:", error);
      clientWs.close();
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
