import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { Dashboard } from './pages/Dashboard';
import { ClientAIChat } from './pages/ClientAIChat';
import { CandidateAI } from './pages/CandidateAI';

function App() {
  return (
    <BrowserRouter>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:wght@400&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root {
          height: 100%;
          background: #0f0f11;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          -webkit-font-smoothing: antialiased;
        }

        /* Typing bounce animation */
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
        @keyframes chatMsgIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* Custom scrollbar */
        ::-webkit-scrollbar { width: 5px; background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.2); border-radius: 100px; }
        ::-webkit-scrollbar-track { background: transparent; }

        button { font-family: inherit; }
        textarea { font-family: inherit; }
      `}</style>

      <div style={{ display:'flex', height:'100vh', width:'100vw', overflow:'hidden', background:'#0f0f11' }}>
        <Sidebar />
        <div style={{ display:'flex', flexDirection:'column', flex:1, minWidth:0, overflow:'hidden' }}>
          <Topbar />
          <main style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column', background:'#0f0f11' }}>
            <Routes>
              <Route path="/" element={<Navigate to="/chat-ai" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/chat-ai" element={<ClientAIChat />} />
              <Route path="/candidate-ai" element={<CandidateAI />} />
              <Route path="*" element={<Navigate to="/chat-ai" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
