import React, { useState, useEffect, useMemo } from 'react';
import { Mail, Phone, Printer, Send, FileJson, FileText, CheckCircle, AlertCircle, Loader2, MessageSquare, Bell, Smartphone, ExternalLink, Zap, Download, Table, Clock, Inbox } from 'lucide-react';
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
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
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

type InboxItem = {
  id: string;
  logNumber: string;
  text: string;
  channel: string;
  timestamp: number;
  status: 'pending' | 'processing' | 'processed';
  canonicalData?: CanonicalData;
};

export default function App() {
  const isSender = new URLSearchParams(window.location.search).get('sender') === 'true';

  if (isSender) {
    return <SenderApp />;
  }

  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<{id: number, text: string, channel: string}[]>([]);
  const [excelDownloadUrl, setExcelDownloadUrl] = useState<string>('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);

  const activeItem = useMemo(() => inboxItems.find(i => i.id === activeItemId), [inboxItems, activeItemId]);
  const processedRecords = useMemo(() => inboxItems.filter(i => i.status === 'processed' && i.canonicalData), [inboxItems]);

  const handleProcess = async (itemToProcess: InboxItem) => {
    setInboxItems(prev => prev.map(item => item.id === itemToProcess.id ? { ...item, status: 'processing' } : item));
    try {
      const response = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: itemToProcess.text, source_channel: itemToProcess.channel })
      });
      const data = await response.json();
      if (data.parsed) {
        setInboxItems(prev => prev.map(item => 
          item.id === itemToProcess.id 
            ? { ...item, status: 'processed', canonicalData: data.parsed }
            : item
        ));
      } else {
        alert(data.error || 'Failed to parse');
        setInboxItems(prev => prev.map(item => item.id === itemToProcess.id ? { ...item, status: 'pending' } : item));
      }
    } catch (err) {
      alert('Error connecting to server');
      setInboxItems(prev => prev.map(item => item.id === itemToProcess.id ? { ...item, status: 'pending' } : item));
    }
  };

  const handleUpdateData = (update: any) => {
    if (!activeItem || !activeItem.canonicalData) return;

    const canonicalData = activeItem.canonicalData;
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

    setInboxItems(prev => prev.map(item => 
      item.id === activeItem.id 
        ? { ...item, canonicalData: updatedData }
        : item
    ));
  };

  useEffect(() => {
    if (processedRecords.length === 0) {
      if (excelDownloadUrl) {
        URL.revokeObjectURL(excelDownloadUrl);
        setExcelDownloadUrl('');
      }
      return;
    }
    
    const exportData = processedRecords.map((record, index) => {
      const can = record.canonicalData!;
      const vde = mapCanonicalToVDE(can);
      return {
        "Log Number": record.logNumber,
        "Record ID": index + 1,
        "Source Channel": can.source_channel ? can.source_channel.toUpperCase() : "UNKNOWN",
        "Applicant First Name": can.applicant.firstName || "",
        "Applicant Last Name": can.applicant.lastName || "",
        "Applicant Email": can.applicant.email || "",
        "Applicant Phone": can.applicant.phone || "",
        "Location Street": can.location.street || "",
        "Location ZIP Code": can.location.zipCode || "",
        "Location City": can.location.city || "",
        "System Power (kW)": can.technical.powerKw || "",
        "Is PV System": can.technical.isPvSystem ? "Yes" : "No",
        "Bank IBAN": can.financial.iban || "",
        "Sentiment Analysis": can.sentiment || "Unknown",
        "Application Status": can.missing_mandatory_fields.length === 0 ? "Complete" : "Incomplete",
        "Missing Fields": can.missing_mandatory_fields.join(", ") || "None",
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
    
    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    
    setExcelDownloadUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [processedRecords]);

  useEffect(() => {
    const initialItem: InboxItem = {
      id: "mock-1",
      logNumber: "LOG-9021",
      text: mockInputs.email,
      channel: "email",
      timestamp: Date.now() - 1000 * 60 * 5,
      status: 'pending'
    };
    setInboxItems([initialItem]);
    setActiveItemId(initialItem.id);

    const sse = new EventSource('/api/stream');
    sse.onmessage = async (e) => {
      const data = JSON.parse(e.data);
      playChime();
      
      const newNotif = { id: Date.now(), text: data.text, channel: data.source_channel };
      setNotifications(prev => [...prev, newNotif]);
      setTimeout(() => { setNotifications(prev => prev.filter(n => n.id !== newNotif.id)); }, 5000);

      const newItem: InboxItem = {
        id: Date.now().toString(),
        logNumber: `LOG-${Math.floor(Math.random() * 90000) + 10000}`,
        text: data.text,
        channel: data.source_channel,
        timestamp: Date.now(),
        status: 'processing'
      };
      
      setInboxItems(prev => [newItem, ...prev]);
      setActiveItemId(newItem.id);
      
      try {
        const response = await fetch('/api/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: data.text, source_channel: data.source_channel })
        });
        const parseData = await response.json();
        if (parseData.parsed) {
          setInboxItems(prev => prev.map(item => 
            item.id === newItem.id 
              ? { ...item, status: 'processed', canonicalData: parseData.parsed }
              : item
          ));
        } else {
          setInboxItems(prev => prev.map(item => item.id === newItem.id ? { ...item, status: 'pending' } : item));
        }
      } catch (err) {
        setInboxItems(prev => prev.map(item => item.id === newItem.id ? { ...item, status: 'pending' } : item));
      }
    };
    return () => sse.close();
  }, []);

  const getSourceIcon = (channel: string) => {
    if (channel === 'email') return <Mail className="w-5 h-5" />;
    if (channel === 'fax') return <Printer className="w-5 h-5" />;
    if (channel === 'phone_call') return <Phone className="w-5 h-5" />;
    if (channel === 'sms') return <MessageSquare className="w-5 h-5" />;
    return <Mail className="w-5 h-5" />;
  };

  const getTimeAgo = (timestamp: number) => {
    const diff = Math.max(0, Math.floor((now - timestamp) / 1000));
    if (diff < 60) return `${diff}s ago`;
    const m = Math.floor(diff / 60);
    if (m < 60) return `${m}m ago`;
    return `${Math.floor(m / 60)}h ago`;
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans relative flex flex-col">
      {/* Toast Notifications */}
      <div className="fixed top-6 right-6 z-50 flex flex-col gap-3 pointer-events-none">
        {notifications.map(n => (
          <div key={n.id} className="bg-white border-l-4 border-red-600 shadow-2xl p-4 rounded-lg w-80 animate-in slide-in-from-right fade-in duration-300 pointer-events-auto">
            <h4 className="font-bold text-red-600 flex items-center gap-2 mb-1 uppercase tracking-wide text-xs">
              <Bell className="w-4 h-4 animate-bounce" /> New {n.channel.replace('_', ' ')} Received
            </h4>
            <p className="text-sm text-gray-700 truncate font-medium">{n.text}</p>
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="bg-red-600 text-white py-6 px-6 shadow-md mb-6 shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col gap-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
             <div>
               <div className="flex items-center gap-3">
                 <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center shadow-sm">
                   <div className="w-6 h-6 bg-red-600 rounded-sm transform rotate-45"></div>
                 </div>
                 <h1 className="text-3xl font-bold tracking-tight">Netz Halle</h1>
               </div>
               <h2 className="text-xl font-medium text-red-100 flex items-center gap-2 mt-2">
                 <Zap className="w-5 h-5" /> Grid Connection Portal
               </h2>
             </div>
             <a href="?sender=true" target="_blank" rel="noopener noreferrer" className="bg-red-700 hover:bg-red-800 text-white border border-red-500 px-5 py-2.5 rounded-lg font-bold text-sm transition-colors flex items-center gap-2 whitespace-nowrap shadow-sm">
               Open Live Sender <ExternalLink className="w-4 h-4" />
             </a>
          </div>
        </div>
      </header>

      <div className="flex-1 w-full max-w-7xl mx-auto px-4 md:px-6 grid grid-cols-1 lg:grid-cols-12 gap-6 pb-12">
        
        {/* Left Column: Inbox Queue (col span 4) */}
        <div className="lg:col-span-4 flex flex-col gap-4 h-[calc(100vh-140px)] sticky top-6">
           <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-full">
              <div className="bg-gray-50 px-5 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
                 <h2 className="font-bold text-gray-800 flex items-center gap-2 uppercase tracking-wide text-sm">
                    <Inbox className="w-5 h-5 text-red-600" /> Incoming Queue
                 </h2>
                 <span className="bg-red-100 text-red-800 text-xs font-bold px-2 py-1 rounded-full">{inboxItems.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50/30">
                 {inboxItems.length === 0 ? (
                   <p className="text-sm text-gray-500 text-center py-8">Queue is empty</p>
                 ) : (
                   inboxItems.map(item => (
                     <div 
                       key={item.id} 
                       onClick={() => setActiveItemId(item.id)}
                       className={`p-4 rounded-lg cursor-pointer transition-all border ${activeItemId === item.id ? 'bg-red-50 border-red-200 shadow-sm' : 'bg-white border-gray-100 hover:border-red-100 hover:bg-gray-50'}`}
                     >
                       <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`p-1.5 rounded-md ${activeItemId === item.id ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'}`}>
                              {getSourceIcon(item.channel)}
                            </span>
                            <span className="font-bold text-sm text-gray-800">{item.logNumber}</span>
                          </div>
                          <div className="flex items-center gap-1 text-xs text-gray-500 font-medium">
                            <Clock className="w-3 h-3" /> {getTimeAgo(item.timestamp)}
                          </div>
                       </div>
                       <p className="text-xs text-gray-600 line-clamp-2 leading-relaxed mb-3">{item.text}</p>
                       <div className="flex items-center justify-between">
                         <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{item.channel.replace('_', ' ')}</span>
                         {item.status === 'pending' && <span className="flex h-2.5 w-2.5 bg-yellow-400 rounded-full" title="Pending"></span>}
                         {item.status === 'processing' && <Loader2 className="w-3.5 h-3.5 text-red-500 animate-spin" />}
                         {item.status === 'processed' && <span className="flex h-2.5 w-2.5 bg-green-500 rounded-full" title="Processed"></span>}
                       </div>
                     </div>
                   ))
                 )}
              </div>
           </div>
        </div>

        {/* Right Column: Detail View (col span 8) */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {activeItem ? (
             <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
               {/* Left Half: Original Message & Processing */}
               <div className="flex flex-col gap-6">
                 <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
                   <div className="bg-gray-50 px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                      <h2 className="font-semibold text-gray-800 flex items-center gap-2 text-sm">
                        {getSourceIcon(activeItem.channel)} Original Message ({activeItem.logNumber})
                      </h2>
                   </div>
                   <div className="p-5 bg-white">
                     <textarea 
                       readOnly
                       className="w-full h-48 resize-none outline-none text-sm text-gray-700 leading-relaxed font-mono bg-gray-50 p-4 rounded-lg border border-gray-100"
                       value={activeItem.text}
                     />
                   </div>
                   <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
                     {activeItem.status === 'pending' ? (
                       <button 
                         onClick={() => handleProcess(activeItem)}
                         className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-lg text-sm font-bold transition-all duration-200 flex items-center gap-2 shadow-sm"
                       >
                         <Send className="w-4 h-4" /> Process Now
                       </button>
                     ) : activeItem.status === 'processing' ? (
                       <button disabled className="bg-gray-400 text-white px-5 py-2 rounded-lg text-sm font-bold flex items-center gap-2">
                         <Loader2 className="w-4 h-4 animate-spin" /> Processing...
                       </button>
                     ) : (
                       <button disabled className="bg-green-600 text-white px-5 py-2 rounded-lg text-sm font-bold flex items-center gap-2">
                         <CheckCircle className="w-4 h-4" /> Processed
                       </button>
                     )}
                   </div>
                 </div>

                 {/* TINA Integrations Table (Appears below message if processed) */}
                 {processedRecords.length > 0 && activeItem.status === 'processed' && (
                   <div className="bg-white rounded-xl shadow-md border border-gray-100 overflow-hidden">
                      <div className="bg-red-600 px-5 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Table className="w-5 h-5 text-white" />
                          <h2 className="font-bold text-sm text-white uppercase tracking-wide">TINA Master Records ({processedRecords.length})</h2>
                        </div>
                        {excelDownloadUrl && (
                          <a 
                            href={excelDownloadUrl}
                            download="netz-halle-registrations.xlsx"
                            className="bg-white text-red-600 hover:bg-red-50 px-4 py-1.5 rounded-md font-bold text-xs transition-all shadow-sm flex items-center gap-2"
                          >
                            <Download className="w-3.5 h-3.5" /> Export DB to Excel
                          </a>
                        )}
                      </div>
                      <div className="overflow-x-auto max-h-[400px]">
                        <table className="w-full text-xs text-left text-gray-600">
                          <thead className="text-[10px] text-gray-700 uppercase bg-gray-50 border-b border-gray-100 sticky top-0">
                            <tr>
                              <th className="px-4 py-3 font-bold">Log</th>
                              <th className="px-4 py-3 font-bold">Name</th>
                              <th className="px-4 py-3 font-bold">Power</th>
                              <th className="px-4 py-3 font-bold">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {processedRecords.map((record) => (
                              <tr key={record.id} className={`hover:bg-gray-50 transition-colors ${record.id === activeItem.id ? 'bg-red-50/50' : ''}`}>
                                <td className="px-4 py-3 font-bold text-gray-900">{record.logNumber}</td>
                                <td className="px-4 py-3 truncate max-w-[100px]">{(record.canonicalData?.applicant.firstName || '') + ' ' + (record.canonicalData?.applicant.lastName || '')}</td>
                                <td className="px-4 py-3 font-mono">{record.canonicalData?.technical.powerKw ? `${record.canonicalData.technical.powerKw} kW` : '-'}</td>
                                <td className="px-4 py-3">
                                  {record.canonicalData?.missing_mandatory_fields.length === 0 ? (
                                    <span className="text-green-600 font-bold">Complete</span>
                                  ) : (
                                    <span className="text-red-600 font-bold" title={record.canonicalData?.missing_mandatory_fields.join(", ")}>Incomplete</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                   </div>
                 )}
               </div>

               {/* Right Half: Output Data */}
               <div className="space-y-6">
                 {activeItem.status === 'processing' && (
                   <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-gray-500 rounded-xl p-10 bg-white border border-red-100 shadow-md">
                      <div className="relative">
                        <div className="absolute inset-0 bg-red-100 rounded-full animate-ping opacity-75"></div>
                        <Loader2 className="w-12 h-12 animate-spin relative text-red-600" />
                      </div>
                      <p className="text-sm font-bold mt-6 tracking-wide text-red-600 animate-pulse uppercase">AI Engine Processing...</p>
                   </div>
                 )}

                 {activeItem.status === 'processed' && activeItem.canonicalData && (
                    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-300">
                       
                       {/* Status Card */}
                       <div className={`p-5 rounded-xl border flex items-start gap-4 shadow-sm ${activeItem.canonicalData.missing_mandatory_fields.length === 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                         {activeItem.canonicalData.missing_mandatory_fields.length === 0 ? (
                            <CheckCircle className="w-7 h-7 text-green-600 mt-0.5 flex-shrink-0" />
                         ) : (
                            <AlertCircle className="w-7 h-7 text-red-600 mt-0.5 flex-shrink-0" />
                         )}
                         <div>
                           <h3 className={`font-bold text-lg ${activeItem.canonicalData.missing_mandatory_fields.length === 0 ? 'text-green-800' : 'text-red-800'}`}>
                             {activeItem.canonicalData.missing_mandatory_fields.length === 0 ? 'Data Extraction Complete' : 'Incomplete Application'}
                           </h3>
                           <p className={`text-sm mt-1 leading-relaxed ${activeItem.canonicalData.missing_mandatory_fields.length === 0 ? 'text-green-700' : 'text-red-700'}`}>
                             {activeItem.canonicalData.missing_mandatory_fields.length === 0 
                               ? 'All required fields were successfully detected and mapped.' 
                               : `${activeItem.canonicalData.missing_mandatory_fields.length} mandatory field(s) are missing and need to be requested from the customer.`}
                           </p>
                         </div>
                       </div>

                       {/* Live AI Voice Assistant Callback */}
                       {activeItem.canonicalData.missing_mandatory_fields.length > 0 && activeItem.channel === 'phone_call' && (
                         <LiveCall 
                           missingFields={activeItem.canonicalData.missing_mandatory_fields.join(", ")} 
                           customerName={activeItem.canonicalData.applicant.firstName ? `${activeItem.canonicalData.applicant.firstName} ${activeItem.canonicalData.applicant.lastName || ''}`.trim() : 'Customer'}
                           onDataUpdate={handleUpdateData}
                         />
                       )}

                       {/* Generated Response for non-phone channels */}
                       {activeItem.canonicalData.missing_mandatory_fields.length > 0 && activeItem.channel !== 'phone_call' && (
                         <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                           <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex items-center gap-2">
                             <Mail className="w-4 h-4 text-red-600" />
                             <h2 className="font-bold text-sm text-gray-800 uppercase tracking-wide">Automated Response (Preview)</h2>
                           </div>
                           <div className="p-5 text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                             {generateMissingFieldsResponse(activeItem.canonicalData)}
                           </div>
                         </div>
                       )}

                       {/* Canonical JSON */}
                       <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                         <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex items-center gap-2">
                           <FileJson className="w-4 h-4 text-red-600" />
                           <h2 className="font-bold text-sm text-gray-800 uppercase tracking-wide">Canonical JSON</h2>
                         </div>
                         <div className="p-4 bg-gray-900 text-green-400 overflow-auto max-h-64 text-xs font-mono rounded-b-xl">
                           <pre>{JSON.stringify(activeItem.canonicalData, null, 2)}</pre>
                         </div>
                       </div>

                       {/* VDE Target Format */}
                       <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                         <div className="bg-gray-50 px-5 py-3 border-b border-gray-200 flex items-center gap-2">
                           <FileText className="w-4 h-4 text-red-600" />
                           <h2 className="font-bold text-sm text-gray-800 uppercase tracking-wide">Internal Target Format (VDE Mapping)</h2>
                         </div>
                         <div className="p-4 bg-gray-50 text-gray-800 overflow-auto max-h-64 text-xs font-mono rounded-b-xl border-t border-gray-100">
                           <pre>{JSON.stringify(mapCanonicalToVDE(activeItem.canonicalData), null, 2)}</pre>
                         </div>
                       </div>

                    </div>
                 )}
               </div>
             </div>
          ) : (
             <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-xl border-2 border-dashed border-gray-200 shadow-sm text-gray-400 p-12 min-h-[400px]">
                <Inbox className="w-12 h-12 mb-4 text-gray-300" />
                <p className="font-bold text-lg text-gray-500">Select an item from the queue</p>
                <p className="text-sm mt-1">View message details and processing status</p>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
