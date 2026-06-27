import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Loader2 } from 'lucide-react';

function pcmToBase64(pcmData: Float32Array): string {
    const buffer = new ArrayBuffer(pcmData.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < pcmData.length; i++) {
        let s = Math.max(-1, Math.min(1, pcmData[i]));
        s = s < 0 ? s * 0x8000 : s * 0x7fff;
        view.setInt16(i * 2, s, true);
    }
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function LiveCall({ 
  missingFields = "", 
  customerName = "",
  onDataUpdate
}: { 
  missingFields?: string, 
  customerName?: string,
  onDataUpdate?: (data: any) => void
}) {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef(0);

  const startCall = async () => {
    try {
      setIsConnecting(true);
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let wsUrl = `${protocol}//${window.location.host}/live`;
      if (missingFields) {
        wsUrl += `?missingFields=${encodeURIComponent(missingFields)}&name=${encodeURIComponent(customerName)}`;
      }
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const inputAudioCtx = new AudioContext({ sampleRate: 16000 });
      const outputAudioCtx = new AudioContext({ sampleRate: 24000 });
      inputAudioCtxRef.current = inputAudioCtx;
      outputAudioCtxRef.current = outputAudioCtx;

      ws.onopen = async () => {
        setIsConnecting(false);
        setIsActive(true);
        nextStartTimeRef.current = outputAudioCtx.currentTime;

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;

        const source = inputAudioCtx.createMediaStreamSource(stream);
        sourceRef.current = source;

        const processor = inputAudioCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        source.connect(processor);
        processor.connect(inputAudioCtx.destination);

        processor.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN) {
            const base64 = pcmToBase64(e.inputBuffer.getChannelData(0));
            ws.send(JSON.stringify({ audio: base64 }));
          }
        };
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.audio) {
          playAudioChunk(outputAudioCtx, msg.audio);
        }
        if (msg.interrupted) {
           nextStartTimeRef.current = outputAudioCtx.currentTime; // clear queue
        }
        if (msg.updateData && onDataUpdate) {
           onDataUpdate(msg.updateData);
        }
      };

      ws.onerror = (e) => {
        console.error("WS Error:", e);
        stopCall();
      };

      ws.onclose = () => {
        stopCall();
      };

    } catch (err) {
      console.error("Failed to start call:", err);
      stopCall();
    }
  };

  const playAudioChunk = (ctx: AudioContext, base64Audio: string) => {
    const binaryStr = atob(base64Audio);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }
    const view = new DataView(bytes.buffer);
    const pcmData = new Float32Array(len / 2);
    for (let i = 0; i < len / 2; i++) {
        pcmData[i] = view.getInt16(i * 2, true) / 32768;
    }
    const buffer = ctx.createBuffer(1, pcmData.length, 24000);
    buffer.getChannelData(0).set(pcmData);
    
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    
    const now = ctx.currentTime;
    if (nextStartTimeRef.current < now) {
      nextStartTimeRef.current = now;
    }
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += buffer.duration;
  };

  const stopCall = () => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (inputAudioCtxRef.current) {
      inputAudioCtxRef.current.close();
      inputAudioCtxRef.current = null;
    }
    if (outputAudioCtxRef.current) {
      outputAudioCtxRef.current.close();
      outputAudioCtxRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsActive(false);
    setIsConnecting(false);
  };

  useEffect(() => {
    return () => {
      stopCall();
    };
  }, []);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="bg-blue-50 px-5 py-3 border-b border-blue-100 flex items-center justify-between">
        <h2 className="font-bold text-sm text-blue-800 uppercase tracking-wide flex items-center gap-2">
          <Phone className="w-4 h-4 text-blue-600" />
          AI Voice Callback Assistant
        </h2>
        
        {!isActive && !isConnecting && (
          <button
            onClick={startCall}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all flex items-center gap-2 transform hover:-translate-y-0.5"
          >
            <Phone className="w-3 h-3" /> Start Callback
          </button>
        )}

        {isConnecting && (
          <button
            disabled
            className="bg-gray-400 text-white px-4 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-2 cursor-not-allowed"
          >
            <Loader2 className="w-3 h-3 animate-spin" /> Connecting...
          </button>
        )}

        {isActive && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-green-700 text-xs font-bold">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              In Call
            </div>
            <button
              onClick={stopCall}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all flex items-center gap-2 transform hover:-translate-y-0.5"
            >
              <PhoneOff className="w-3 h-3" /> End
            </button>
          </div>
        )}
      </div>

      {isActive ? (
        <div className="p-8 bg-gray-50 flex flex-col items-center justify-center border-t border-gray-100">
          <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center relative mb-3 animate-pulse">
            <Mic className="w-8 h-8" />
            <div className="absolute inset-0 border-4 border-blue-400 rounded-full animate-ping opacity-20"></div>
          </div>
          <p className="text-gray-600 font-medium text-sm">Listening... Speak now.</p>
        </div>
      ) : (
        <div className="p-5 text-sm text-gray-600 leading-relaxed">
          <p>The customer's application is incomplete. You can use the AI Voice Assistant to call the customer back and gather the missing information automatically.</p>
          {missingFields && (
            <div className="mt-3 p-3 bg-red-50 rounded text-red-800 text-xs font-mono border border-red-100">
              Missing: {missingFields}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
