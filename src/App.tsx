import React, { useState, useEffect } from 'react';
import { Mail, Phone, Printer, Send, FileJson, FileText, CheckCircle, AlertCircle, Loader2, MessageSquare, Bell, Smartphone, ExternalLink, Zap, Download, Table } from 'lucide-react';
import { CanonicalData } from './canonical/types';
import { mapCanonicalToVDE } from './adapters/vde';
import { generateMissingFieldsResponse } from './respond';
import { LiveCall } from './components/LiveCall';
import { validateCanonicalData } from './validate';
import * as XLSX from 'xlsx';

const mockInputs = {
  email: `Hello Netz Halle team,\n\nI would like to register a new PV system at my house located at Musterstraße 1, 12345 Musterstadt. The system has 15.5 kWp.\n\nBest regards,\nMax Mustermann\nmax@example.com`,
  fax: `GRID CONNECTION REGISTRATION\n\nI hereby register a PV system with 8 kW.\nName: Lisa Schmidt\nIBAN: DE12345678901234567890\nLocation: Sonnenweg 5, 54321 Neustadt`,
  phone_call: `Transcript:\nCustomer: Yes hello, this is Thomas Müller. I am totally annoyed because I haven't reached anyone for weeks! I want to register my PV system! The thing has 12 kW and I live in Berlin, Berliner Straße 10, 10115.\nAgent: I understand Mr. Müller. What is your phone number?\nCustomer: 0170 1234567.`,
  sms: `Hi! I'm Anna. I want to connect my 5kW PV system. Address: Markt 1, 06108 Halle. My IBAN is DE99887766554433221100. Call me back!`
};

const playChime = () => {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1); // A6
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    console.error("Audio playback failed", e);
  }
};

function SenderApp() {
  const [text, setText] = useState(mockInputs.sms);
  const [channel, setChannel] = useState('sms');
  const [sent, setSent] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const handleChannelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newChannel = e.target.value as keyof typeof mockInputs;
    setChannel(newChannel);
    setText(mockInputs[newChannel]);
  };

  const send = async () => {
    if (!text) return;
    setIsSending(true);
    try {
      await fetch('/api/webhook/incoming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, source_channel: channel })
      });
      setSent(true);
      setTimeout(() => setSent(false), 2000);
      setText('');
    } catch (e) {
      alert("Failed to send message");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col p-4 md:p-6 font-sans">
      <div className="max-w-md w-full mx-auto">
        <div className="bg-red-600 text-white p-8 rounded-t-2xl shadow-lg text-center">
          <Smartphone className="w-16 h-16 mx-auto mb-4 opacity-90 animate-bounce" />
          <h1 className="text-3xl font-bold tracking-tight">Live Sender</h1>
          <p className="text-red-100 text-sm mt-2">Send messages to the main dashboard in real-time.</p>
        </div>
        <div className="bg-white p-6 md:p-8 rounded-b-2xl shadow-xl space-y-6 border border-t-0 border-gray-100">
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Select Channel</label>
            <select value={channel} onChange={handleChannelChange} className="w-full p-4 rounded-xl border-2 border-gray-200 focus:border-red-600 focus:ring-0 outline-none text-gray-800 font-medium bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer appearance-none">
              <option value="sms">SMS</option>
              <option value="email">Email</option>
              <option value="phone_call">Phone Call</option>
              <option value="fax">Fax</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Message Text</label>
            <textarea value={text} onChange={e=>setText(e.target.value)} className="w-full h-48 p-4 rounded-xl border-2 border-gray-200 focus:border-red-600 focus:ring-0 outline-none resize-none font-mono text-sm leading-relaxed text-gray-700" placeholder="Type your test message here..." />
          </div>
          <button onClick={send} disabled={isSending || !text} className="w-full bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white p-4 rounded-xl font-bold text-lg transition-all shadow-md disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-3">
            {isSending ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
            {isSending ? 'Sending...' : 'Send Live Message'}
          </button>
          {sent && (
            <div className="flex items-center justify-center gap-2 text-green-600 font-medium animate-in fade-in zoom-in duration-300">
              <CheckCircle className="w-5 h-5" />
              Message sent successfully!
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const isSender = new URLSearchParams(window.location.search).get('sender') === 'true';

  if (isSender) {
    return <SenderApp />;
  }

  const [inputText, setInputText] = useState(mockInputs.email);
  const [sourceChannel, setSourceChannel] = useState<'email' | 'fax' | 'phone_call' | 'sms'>('email');
  const [isProcessing, setIsProcessing] = useState(false);
  const [canonicalData, setCanonicalData] = useState<CanonicalData | null>(null);
  const [notifications, setNotifications] = useState<{id: number, text: string, channel: string}[]>([]);
  const [processedRecords, setProcessedRecords] = useState<CanonicalData[]>([]);

  const handleProcess = async (overrideText?: string, overrideChannel?: string) => {
    const textToProcess = overrideText ?? inputText;
    const channelToProcess = overrideChannel ?? sourceChannel;
    
    setIsProcessing(true);
    setCanonicalData(null);
    try {
      const response = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToProcess, source_channel: channelToProcess })
      });
      const data = await response.json();
      if (data.parsed) {
        setCanonicalData(data.parsed);
        setProcessedRecords(prev => [...prev, data.parsed]);
      } else {
        alert(data.error || 'Failed to parse');
      }
    } catch (err) {
      alert('Error connecting to server');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdateData = (update: any) => {
    if (!canonicalData) return;

    // Create a new updated canonical record
    const updatedData: CanonicalData = { 
      ...canonicalData,
      applicant: { ...canonicalData.applicant },
      location: { ...canonicalData.location },
      technical: { ...canonicalData.technical },
      financial: { ...canonicalData.financial },
    };
    
    if (update.firstName) updatedData.applicant.firstName = update.firstName;
    if (update.lastName) updatedData.applicant.lastName = update.lastName;
    if (update.email) updatedData.applicant.email = update.email;
    if (update.phone) updatedData.applicant.phone = update.phone;
    if (update.street) updatedData.location.street = update.street;
    if (update.zipCode) updatedData.location.zipCode = update.zipCode;
    if (update.city) updatedData.location.city = update.city;
    if (update.powerKw) updatedData.technical.powerKw = update.powerKw;
    if (update.iban) updatedData.financial.iban = update.iban;

    const validation = validateCanonicalData(updatedData);
    updatedData.missing_mandatory_fields = validation.missing;

    setCanonicalData(updatedData);

    // Update the record in processedRecords (matching by reference, or just updating the last one since we are viewing it)
    setProcessedRecords(prev => {
      const newRecords = [...prev];
      if (newRecords.length > 0) {
        newRecords[newRecords.length - 1] = updatedData;
      }
      return newRecords;
    });
  };

  const exportToExcel = () => {
    if (processedRecords.length === 0) return;
    
    const exportData = processedRecords.map((record, index) => {
      const vde = mapCanonicalToVDE(record);
      return {
        "Record ID": index + 1,
        "Source Channel": record.source_channel ? record.source_channel.toUpperCase() : "UNKNOWN",
        "Applicant First Name": record.applicant.firstName || "",
        "Applicant Last Name": record.applicant.lastName || "",
        "Applicant Email": record.applicant.email || "",
        "Applicant Phone": record.applicant.phone || "",
        "Location Street": record.location.street || "",
        "Location ZIP Code": record.location.zipCode || "",
        "Location City": record.location.city || "",
        "System Power (kW)": record.technical.powerKw || "",
        "Is PV System": record.technical.isPvSystem ? "Yes" : "No",
        "Bank IBAN": record.financial.iban || "",
        "Sentiment Analysis": record.sentiment || "Unknown",
        "Application Status": record.missing_mandatory_fields.length === 0 ? "Complete" : "Incomplete",
        "Missing Fields": record.missing_mandatory_fields.join(", ") || "None",
        "VDE_1102_Vorname": vde["1102"] || "",
        "VDE_1101_Name": vde["1101"] || "",
        "VDE_1110_Email": vde["1110"] || "",
        "VDE_1109_Telefon": vde["1109"] || "",
        "VDE_1002_Strasse": vde["1002"] || "",
        "VDE_1007_PLZ": vde["1007"] || "",
        "VDE_1008_Ort": vde["1008"] || "",
        "VDE_3101_PV_Leistung": vde["3101"] || "",
        "VDE_2021_Bestätigung": vde["2021"] || "",
        "VDE_1111_IBAN": vde["1111"] || ""
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "TINA_Import_Data");
    
    XLSX.writeFile(workbook, "Netz_Halle_TINA_Export.xlsx");
  };

  useEffect(() => {
    const sse = new EventSource('/api/stream');
    sse.onmessage = (e) => {
      const data = JSON.parse(e.data);
      playChime();
      
      const newNotif = { id: Date.now(), text: data.text, channel: data.source_channel };
      setNotifications(prev => [...prev, newNotif]);
      
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== newNotif.id));
      }, 5000);

      setSourceChannel(data.source_channel);
      setInputText(data.text);
      
      // Auto trigger processing for the live effect
      handleProcess(data.text, data.source_channel);
    };
    return () => sse.close();
  }, []);

  const getSourceIcon = (channel = sourceChannel) => {
    if (channel === 'email') return <Mail className="w-5 h-5" />;
    if (channel === 'fax') return <Printer className="w-5 h-5" />;
    if (channel === 'phone_call') return <Phone className="w-5 h-5" />;
    if (channel === 'sms') return <MessageSquare className="w-5 h-5" />;
    return null;
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans relative overflow-x-hidden">
      
      {/* Toast Notifications */}
      <div className="fixed top-6 right-6 z-50 flex flex-col gap-3 pointer-events-none">
        {notifications.map(n => (
          <div key={n.id} className="bg-white border-l-4 border-red-600 shadow-2xl p-4 rounded-lg w-80 animate-in slide-in-from-right fade-in duration-300 pointer-events-auto">
            <h4 className="font-bold text-red-600 flex items-center gap-2 mb-1 uppercase tracking-wide text-xs">
              <Bell className="w-4 h-4 animate-bounce" /> New {n.channel} Received
            </h4>
            <p className="text-sm text-gray-700 truncate font-medium">{n.text}</p>
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="bg-red-600 text-white py-6 px-6 shadow-md mb-8">
        <div className="max-w-6xl mx-auto flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm">
              <div className="w-6 h-6 bg-red-600 rounded-sm transform rotate-45"></div>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">Netz Halle</h1>
          </div>
          <h2 className="text-xl font-medium text-red-100 flex items-center gap-2">
            <Zap className="w-5 h-5" /> Grid Connection Portal
          </h2>
          <p className="text-red-200 mt-1">Translation layer: Unstructured Inputs → Canonical JSON → VDE Target Format.</p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto space-y-8 px-6 pb-12">

        {/* Live Demo Instruction Bar */}
        <div className="bg-white p-5 rounded-xl shadow-sm border border-red-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
           <div className="flex items-center gap-4">
             <div className="bg-red-100 p-3 rounded-full text-red-600 shadow-sm relative">
               <Smartphone className="w-6 h-6" />
               <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full animate-ping"></span>
             </div>
             <div>
               <h3 className="font-bold text-gray-800 text-lg">Live Demo Mode Active</h3>
               <p className="text-sm text-gray-500">Open the Sender App on another device to simulate real-time incoming messages.</p>
             </div>
           </div>
           <a href="?sender=true" target="_blank" rel="noopener noreferrer" className="bg-red-50 text-red-600 hover:bg-red-100 px-5 py-2.5 rounded-lg font-bold text-sm transition-colors flex items-center gap-2 whitespace-nowrap">
             Open Live Sender <ExternalLink className="w-4 h-4" />
           </a>
        </div>


        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Left Column: Input */}
          <div className="space-y-6">
            <div className={`bg-white rounded-xl shadow-md border overflow-hidden flex flex-col transition-colors duration-500 ${isProcessing ? 'border-red-300' : 'border-gray-100'}`}>
              <div className="bg-white px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4">
                <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                  {getSourceIcon()} Input Channel
                </h2>
                <div className="flex gap-1 bg-gray-100 p-1 rounded-full">
                  {(['email', 'sms', 'phone_call', 'fax'] as const).map(ch => (
                    <button 
                      key={ch}
                      onClick={() => { setSourceChannel(ch); setInputText(mockInputs[ch]); }}
                      className={`px-3 py-1.5 text-xs font-bold rounded-full transition-all duration-200 uppercase tracking-wide ${sourceChannel === ch ? 'bg-red-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                    >
                      {ch.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-5 flex-1 bg-gray-50/50 relative">
                {isProcessing && (
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] flex items-center justify-center z-10">
                     <div className="bg-white px-4 py-2 rounded-full shadow-lg border border-gray-100 text-red-600 font-bold text-sm flex items-center gap-2">
                       <Loader2 className="w-4 h-4 animate-spin" /> Extracting Data...
                     </div>
                  </div>
                )}
                <textarea 
                  className="w-full h-48 lg:h-64 resize-none outline-none text-sm text-gray-700 leading-relaxed font-mono bg-transparent"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Message text..."
                />
              </div>
              <div className="p-5 border-t border-gray-100 bg-white flex justify-end">
                <button 
                  onClick={() => handleProcess()}
                  disabled={isProcessing}
                  className="bg-red-600 hover:bg-red-700 text-white px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 flex items-center gap-2 shadow-sm disabled:opacity-70 disabled:cursor-not-allowed transform hover:-translate-y-0.5"
                >
                  <Send className="w-4 h-4" />
                  Process Manually
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Output */}
          <div className="space-y-6">
            {!canonicalData && !isProcessing && (
              <div className="h-full flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-200 rounded-xl p-10 text-center bg-white shadow-sm">
                <FileJson className="w-12 h-12 mb-4 text-gray-300" />
                <p className="text-lg font-bold text-gray-500">Waiting for data...</p>
                <p className="text-sm mt-2">Send a message from the Live Sender or click "Process Manually".</p>
              </div>
            )}

            {isProcessing && (
              <div className="h-full flex flex-col items-center justify-center text-gray-500 rounded-xl p-10 bg-white border border-red-100 shadow-md">
                <div className="relative">
                  <div className="absolute inset-0 bg-red-100 rounded-full animate-ping opacity-75"></div>
                  <Loader2 className="w-12 h-12 animate-spin relative text-red-600" />
                </div>
                <p className="text-sm font-bold mt-6 tracking-wide text-red-600 animate-pulse uppercase">AI Engine Processing...</p>
              </div>
            )}

            {canonicalData && (
              <div className="space-y-5 animate-in fade-in slide-in-from-bottom-8 duration-500">
                
                {/* Status Card */}
                <div className={`p-5 rounded-xl border flex items-start gap-4 shadow-sm ${canonicalData.missing_mandatory_fields.length === 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                  {canonicalData.missing_mandatory_fields.length === 0 ? (
                     <CheckCircle className="w-7 h-7 text-green-600 mt-0.5 flex-shrink-0" />
                  ) : (
                     <AlertCircle className="w-7 h-7 text-red-600 mt-0.5 flex-shrink-0" />
                  )}
                  <div>
                    <h3 className={`font-bold text-lg ${canonicalData.missing_mandatory_fields.length === 0 ? 'text-green-800' : 'text-red-800'}`}>
                      {canonicalData.missing_mandatory_fields.length === 0 ? 'Data Extraction Complete' : 'Incomplete Application'}
                    </h3>
                    <p className={`text-sm mt-1 leading-relaxed ${canonicalData.missing_mandatory_fields.length === 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {canonicalData.missing_mandatory_fields.length === 0 
                        ? 'All required fields were successfully detected and mapped.' 
                        : `${canonicalData.missing_mandatory_fields.length} mandatory field(s) are missing and need to be requested from the customer.`}
                    </p>
                  </div>
                </div>

                {/* Canonical JSON */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex items-center gap-2">
                    <FileJson className="w-4 h-4 text-red-600" />
                    <h2 className="font-bold text-sm text-gray-800 uppercase tracking-wide">Canonical JSON</h2>
                  </div>
                  <div className="p-5 bg-gray-900 text-green-400 overflow-auto max-h-64 text-xs font-mono rounded-b-xl">
                    <pre>{JSON.stringify(canonicalData, null, 2)}</pre>
                  </div>
                </div>

                {/* VDE Target Format */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-red-600" />
                    <h2 className="font-bold text-sm text-gray-800 uppercase tracking-wide">Internal Target Format (VDE Mapping)</h2>
                  </div>
                  <div className="p-5 bg-gray-50 text-gray-800 overflow-auto max-h-64 text-xs font-mono rounded-b-xl border-t border-gray-100">
                    <pre>{JSON.stringify(mapCanonicalToVDE(canonicalData), null, 2)}</pre>
                  </div>
                </div>

                {/* Generated Response */}
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex items-center gap-2">
                    <Mail className="w-4 h-4 text-red-600" />
                    <h2 className="font-bold text-sm text-gray-800 uppercase tracking-wide">Automated Response (Preview)</h2>
                  </div>
                  <div className="p-5 text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                    {generateMissingFieldsResponse(canonicalData)}
                  </div>
                </div>

                {/* Live AI Voice Assistant Callback */}
                {canonicalData.missing_mandatory_fields.length > 0 && sourceChannel === 'phone_call' && (
                  <LiveCall 
                    missingFields={canonicalData.missing_mandatory_fields.join(", ")} 
                    customerName={canonicalData.applicant.firstName ? `${canonicalData.applicant.firstName} ${canonicalData.applicant.lastName || ''}`.trim() : 'Customer'}
                    onDataUpdate={handleUpdateData}
                  />
                )}

              </div>
            )}
          </div>
        </div>

        {/* TINA Integrations Table */}
        {processedRecords.length > 0 && (
          <div className="bg-white rounded-xl shadow-md border border-gray-100 overflow-hidden mt-8">
            <div className="bg-red-600 px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Table className="w-6 h-6 text-white" />
                <h2 className="font-bold text-lg text-white uppercase tracking-wide">TINA Master Records ({processedRecords.length})</h2>
              </div>
              <button 
                onClick={exportToExcel}
                className="bg-white text-red-600 hover:bg-red-50 px-5 py-2.5 rounded-lg font-bold text-sm transition-all shadow-sm flex items-center gap-2 transform hover:-translate-y-0.5"
              >
                <Download className="w-4 h-4" /> Export to Excel
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left text-gray-600">
                <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-4 font-bold">ID</th>
                    <th className="px-6 py-4 font-bold">Channel</th>
                    <th className="px-6 py-4 font-bold">First Name</th>
                    <th className="px-6 py-4 font-bold">Last Name</th>
                    <th className="px-6 py-4 font-bold">Power (kW)</th>
                    <th className="px-6 py-4 font-bold">Status</th>
                    <th className="px-6 py-4 font-bold">Missing Fields</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {processedRecords.map((record, idx) => (
                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-900">{idx + 1}</td>
                      <td className="px-6 py-4 uppercase tracking-wider text-xs font-semibold text-gray-500">{record.source_channel}</td>
                      <td className="px-6 py-4">{record.applicant.firstName || '-'}</td>
                      <td className="px-6 py-4">{record.applicant.lastName || '-'}</td>
                      <td className="px-6 py-4 font-mono">{record.technical.powerKw ? `${record.technical.powerKw} kW` : '-'}</td>
                      <td className="px-6 py-4">
                        {record.missing_mandatory_fields.length === 0 ? (
                          <span className="bg-green-100 text-green-800 text-xs font-bold px-2.5 py-1 rounded-full border border-green-200">Complete</span>
                        ) : (
                          <span className="bg-red-100 text-red-800 text-xs font-bold px-2.5 py-1 rounded-full border border-red-200">Incomplete</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-500 max-w-xs truncate" title={record.missing_mandatory_fields.join(", ")}>
                        {record.missing_mandatory_fields.length > 0 ? record.missing_mandatory_fields.length + " missing" : "None"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
