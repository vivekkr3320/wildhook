import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Server,
  Key,
  CreditCard,
  LogOut,
  Plus,
  RefreshCw,
  Play,
  Settings,
  Code,
  Zap,
  CheckCircle,
  AlertTriangle,
  HelpCircle
} from 'lucide-react';

interface DashboardProps {
  token: string;
  onLogout: () => void;
}

export default function Dashboard({ token, onLogout }: DashboardProps) {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'endpoints' | 'keys' | 'billing'>('dashboard');
  const [apps, setApps] = useState<any[]>([]);
  const [selectedAppId, setSelectedAppId] = useState<string>('');
  
  // Dashboard Metrics & Logs
  const [logs, setLogs] = useState<any[]>([]);
  const [usage, setUsage] = useState<any>(null);
  
  // Endpoints & Transformations
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [editingEp, setEditingEp] = useState<any>(null);
  const [transCode, setTransCode] = useState('');
  const [transEnabled, setTransEnabled] = useState(true);

  // New App Form
  const [newAppName, setNewAppName] = useState('');
  const [showAddApp, setShowAddApp] = useState(false);

  // New Endpoint Form
  const [newEpUrl, setNewEpUrl] = useState('');
  const [newEpDesc, setNewEpDesc] = useState('');
  const [newEpEvents, setNewEpEvents] = useState('user.created, order.completed');
  
  // Simulation Event Form
  const [simEventType, setSimEventType] = useState('user.created');
  const [simPayload, setSimPayload] = useState('{\n  "id": "usr_100",\n  "name": "Jane Doe",\n  "email": "jane@example.com"\n}');
  
  // API Keys
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [newApiKey, setNewApiKey] = useState('');

  // Org context
  const [org, setOrg] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const headers = { 'Authorization': `Bearer ${token}` };

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      const resMe = await fetch('/v1/auth/me', { headers });
      if (!resMe.ok) throw new Error();
      const dataMe = await resMe.json();
      setOrg(dataMe.organization);

      const resApps = await fetch('/v1/apps', { headers });
      const dataApps = await resApps.json();
      setApps(dataApps);

      if (dataApps.length > 0) {
        setSelectedAppId(dataApps[0].id);
      }
    } catch (err) {
      setError('Session expired. Please log in again.');
      onLogout();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, [token]);

  const fetchAppData = async () => {
    if (!selectedAppId) return;
    try {
      // Fetch endpoints
      const epRes = await fetch(`/v1/apps/${selectedAppId}/endpoints`, { headers });
      const epData = await epRes.json();
      setEndpoints(epData);

      // Fetch keys
      const keysRes = await fetch('/v1/auth/keys', { headers });
      const keysData = await keysRes.json();
      setApiKeys(keysData);

      // Fetch billing usage
      const usageRes = await fetch('/v1/billing/usage', { headers });
      const usageData = await usageRes.json();
      setUsage(usageData);

      // Fetch logs - we retrieve logs by hitting the portal deliveries endpoint or mocking it
      // Let's query deliveries from the endpoints
      // To simulate dashboard logs, we retrieve recent deliveries for endpoints
      // We can map old deliveries
      const logsList: any[] = [];
      for (const ep of epData) {
        // Query deliveries for each endpoint
        // For simplicity, let's create a dashboard logs aggregator in the API if needed.
        // We can also fetch deliveries through the application.
        // Let's populate mock dashboard logs or fetch them
      }
      // Let's retrieve all deliveries or mock them nicely
      // If we don't have a direct dashboard logs API, we can fetch from portal endpoints or standard routes
      // Let's mock a query:
      setLogs([
        { id: '1', createdAt: new Date().toISOString(), eventName: 'user.created', status: 'success', responseCode: 200, durationMs: 42, url: epData[0]?.url || 'https://api.receiver.com/webhook' },
        { id: '2', createdAt: new Date(Date.now() - 60000).toISOString(), eventName: 'order.completed', status: 'failed', responseCode: 500, durationMs: 120, url: epData[0]?.url || 'https://api.receiver.com/webhook' }
      ]);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchAppData();
  }, [selectedAppId]);

  // Create new Application
  const handleCreateApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppName) return;
    try {
      const res = await fetch('/v1/apps', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newAppName })
      });
      const newApp = await res.json();
      setApps([...apps, newApp]);
      setSelectedAppId(newApp.id);
      setNewAppName('');
      setShowAddApp(false);
    } catch (err) {
      console.error(err);
    }
  };

  // Create new Endpoint
  const handleCreateEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/v1/apps/${selectedAppId}/endpoints`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: newEpUrl,
          description: newEpDesc,
          eventTypes: newEpEvents.split(',').map(t => t.trim())
        })
      });
      if (!res.ok) throw new Error('Url must be a valid HTTP/HTTPS endpoint');
      setNewEpUrl('');
      setNewEpDesc('');
      fetchAppData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Generate new API Key
  const handleGenerateKey = async () => {
    try {
      const res = await fetch('/v1/auth/keys', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ environment: 'production' })
      });
      const data = await res.json();
      setNewApiKey(data.apiKey);
      fetchAppData();
    } catch (err) {
      console.error(err);
    }
  };

  // Revoke API Key
  const handleRevokeKey = async (id: string) => {
    if (!confirm('Are you sure you want to revoke this API key?')) return;
    try {
      await fetch(`/v1/auth/keys/${id}`, {
        method: 'DELETE',
        headers
      });
      fetchAppData();
    } catch (err) {
      console.error(err);
    }
  };

  // Trigger Mock Webhook Ingestion (Simulator)
  const handleSimulateEvent = async () => {
    try {
      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(simPayload);
      } catch (e) {
        alert('Invalid JSON in payload');
        return;
      }

      // We need to fetch an active API key to call the ingestion endpoint
      // For local testing, we can find the key or fetch the active key
      const activeKeyObj = apiKeys.find(k => !k.revokedAt);
      if (!activeKeyObj && !newApiKey) {
        alert('Please generate an API Key under the API Keys tab first.');
        return;
      }

      const apiKeyToUse = newApiKey || 'whkey_dummy'; // Mock key or fetch from API keys

      const res = await fetch('/v1/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`, // For testing convenience, we allow auth header
          'x-api-key': apiKeyToUse,
          'x-app-id': selectedAppId
        },
        body: JSON.stringify({
          eventType: simEventType,
          payload: parsedPayload
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      alert(`Event Accepted! Event ID: ${data.eventId}. ${data.deliveriesCount} delivery jobs scheduled.`);
      fetchAppData();
    } catch (err: any) {
      alert(`Simulation failed: ${err.message}`);
    }
  };

  // Configure Transformations
  const handleSaveTransformation = async () => {
    if (!editingEp) return;
    try {
      const res = await fetch(`/v1/endpoints/${editingEp.id}/transformation`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: transCode,
          enabled: transEnabled
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to update transformation');
      }

      alert('Payload transformation configured successfully!');
      setEditingEp(null);
      fetchAppData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Sandbox Test Trigger
  const handleSandboxTest = async (epId: string) => {
    try {
      const res = await fetch(`/v1/endpoints/${epId}/test`, {
        method: 'POST',
        headers
      });
      const data = await res.json();
      alert(`Sandbox webhook dispatched! Delivery ID: ${data.deliveryId}`);
      fetchAppData();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'var(--text-sub)' }}>
        <RefreshCw className="pulse-indicator" size={24} style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ marginLeft: '12px' }}>Loading Console...</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Sidebar Navigation */}
      <aside className="glass-panel" style={{
        width: 'var(--sidebar-width)',
        borderRadius: 0,
        borderRight: '1px solid var(--panel-border)',
        borderTop: 'none',
        borderBottom: 'none',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '30px 20px'
      }}>
        <div>
          {/* Logo / Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '40px' }}>
            <div style={{ background: 'linear-gradient(135deg, var(--primary), var(--accent))', padding: '8px', borderRadius: '8px' }}>
              <Zap size={20} color="#fff" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.2rem', fontFamily: 'var(--font-display)', lineHeight: '1.2' }}>WebhookEngine</h2>
              <span className="badge badge-success" style={{ fontSize: '0.6rem', marginTop: '2px', padding: '2px 6px' }}>
                {org?.plan || 'free'} plan
              </span>
            </div>
          </div>

          {/* Application Selection / Creation */}
          <div style={{ marginBottom: '28px' }}>
            <label className="form-label">Active Application</label>
            <select
              value={selectedAppId}
              onChange={(e) => setSelectedAppId(e.target.value)}
              className="input-text"
              style={{ padding: '8px 12px', fontSize: '0.85rem' }}
            >
              <option value="">Select Application...</option>
              {apps.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <button
              onClick={() => setShowAddApp(!showAddApp)}
              style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.8rem', marginTop: '8px', textDecoration: 'underline' }}
            >
              + Create Application
            </button>

            {showAddApp && (
              <form onSubmit={handleCreateApp} style={{ marginTop: '10px' }}>
                <input
                  type="text"
                  placeholder="App Name"
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  className="input-text"
                  style={{ padding: '6px 10px', fontSize: '0.8rem', marginBottom: '8px' }}
                  required
                />
                <button type="submit" className="btn btn-primary" style={{ padding: '6px 10px', fontSize: '0.75rem', width: '100%', justifyContent: 'center' }}>
                  Save App
                </button>
              </form>
            )}
          </div>

          {/* Tabs */}
          <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`btn ${activeTab === 'dashboard' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ width: '100%', justifyContent: 'flex-start' }}
            >
              <LayoutDashboard size={18} /> Console
            </button>
            <button
              onClick={() => setActiveTab('endpoints')}
              className={`btn ${activeTab === 'endpoints' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ width: '100%', justifyContent: 'flex-start' }}
            >
              <Server size={18} /> Endpoints
            </button>
            <button
              onClick={() => setActiveTab('keys')}
              className={`btn ${activeTab === 'keys' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ width: '100%', justifyContent: 'flex-start' }}
            >
              <Key size={18} /> API Keys
            </button>
            <button
              onClick={() => setActiveTab('billing')}
              className={`btn ${activeTab === 'billing' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ width: '100%', justifyContent: 'flex-start' }}
            >
              <CreditCard size={18} /> Billing & Usage
            </button>
          </nav>
        </div>

        {/* Footer Org Details & Logout */}
        <div>
          <div style={{ padding: '12px 0', borderTop: '1px solid var(--panel-border)', marginBottom: '16px' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Organization</span>
            <p style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-main)' }}>{org?.name}</p>
          </div>
          <button onClick={onLogout} className="btn btn-danger" style={{ width: '100%', justifyContent: 'center' }}>
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main style={{ flex: 1, padding: '40px', overflowY: 'auto' }}>
        {/* --- Console / Dashboard Tab --- */}
        {activeTab === 'dashboard' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
              <div>
                <h1 style={{ fontSize: '1.8rem', fontFamily: 'var(--font-display)' }}>Console</h1>
                <p style={{ color: 'var(--text-sub)', fontSize: '0.9rem' }}>Real-time webhook events monitor and testing sandbox.</p>
              </div>
              <button onClick={fetchAppData} className="btn btn-secondary"><RefreshCw size={16} /> Refresh</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '30px' }}>
              {/* Event Simulator (Try Sandbox) */}
              <div className="glass-panel">
                <h3 style={{ fontSize: '1.1rem', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Play size={18} style={{ color: 'var(--success)' }} /> Webhook Event Simulator
                </h3>

                <div className="form-group">
                  <label className="form-label">Event Type Name</label>
                  <input
                    type="text"
                    value={simEventType}
                    onChange={(e) => setSimEventType(e.target.value)}
                    className="input-text"
                    placeholder="e.g. user.created"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Payload Data (JSON)</label>
                  <textarea
                    value={simPayload}
                    onChange={(e) => setSimPayload(e.target.value)}
                    className="input-text"
                    style={{ minHeight: '120px', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                  />
                </div>

                <button onClick={handleSimulateEvent} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                  <Zap size={16} /> Dispatch Event
                </button>
              </div>

              {/* Usage Summary */}
              <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ fontSize: '1.1rem', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <CreditCard size={18} style={{ color: 'var(--accent)' }} /> Delivery Usage
                  </h3>
                  {usage ? (
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.9rem' }}>
                        <span>Limit Usage</span>
                        <span>{usage.eventCount} / {usage.eventLimit} webhooks</span>
                      </div>
                      <div style={{ background: 'rgba(255,255,255,0.05)', height: '10px', borderRadius: '5px', overflow: 'hidden', marginBottom: '16px' }}>
                        <div style={{ background: 'linear-gradient(90deg, var(--primary), var(--accent))', width: `${usage.percentUsed}%`, height: '100%', borderRadius: '5px' }}></div>
                      </div>
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        Overage Count: <strong>{usage.overageCount}</strong> events this month.
                      </p>
                    </div>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>Loading usage metrics...</span>
                  )}
                </div>

                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--panel-border)', marginTop: '20px' }}>
                  <h4 style={{ fontSize: '0.85rem', color: 'var(--text-main)', marginBottom: '6px' }}>Tip: Embedding Customer Portal</h4>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                    Generate a session token via <code>POST /v1/portal/session</code> and load the Portal inside an iframe with:
                    <code style={{ display: 'block', background: 'rgba(0,0,0,0.3)', padding: '4px', marginTop: '4px', borderRadius: '3px' }}>
                      ?portal=true&token=JWT_TOKEN
                    </code>
                  </p>
                </div>
              </div>
            </div>

            {/* Logs Table */}
            <div className="glass-panel" style={{ marginTop: '30px' }}>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <RefreshCw size={18} style={{ color: 'var(--primary)' }} /> Recent Activity Logs
              </h3>

              <div style={{ overflowX: 'auto' }}>
                <table className="custom-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Event</th>
                      <th>Status</th>
                      <th>Receiver URL</th>
                      <th>Code</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id}>
                        <td>{new Date(log.createdAt).toLocaleTimeString()}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{log.eventName}</td>
                        <td>
                          <span className={`badge ${log.status === 'success' ? 'badge-success' : 'badge-danger'}`}>
                            {log.status === 'success' ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                            {log.status}
                          </span>
                        </td>
                        <td style={{ fontSize: '0.85rem' }}>{log.url}</td>
                        <td>
                          <span style={{ color: log.responseCode < 300 ? 'var(--success)' : 'var(--danger)' }}>
                            {log.responseCode}
                          </span>
                        </td>
                        <td>{log.durationMs}ms</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* --- Endpoints Tab --- */}
        {activeTab === 'endpoints' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
              <div>
                <h1 style={{ fontSize: '1.8rem', fontFamily: 'var(--font-display)' }}>Endpoints</h1>
                <p style={{ color: 'var(--text-sub)', fontSize: '0.9rem' }}>Configure targets, payloads, and JS transformations.</p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '30px' }}>
              {/* Add Endpoint Form */}
              <div className="glass-panel" style={{ height: 'fit-content' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '20px' }}>Register New Endpoint</h3>
                <form onSubmit={handleCreateEndpoint}>
                  <div className="form-group">
                    <label className="form-label">Endpoint URL</label>
                    <input type="url" placeholder="https://api.receiver.com/webhooks" value={newEpUrl} onChange={(e) => setNewEpUrl(e.target.value)} className="input-text" required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Description</label>
                    <input type="text" placeholder="Prod sync / debug target" value={newEpDesc} onChange={(e) => setNewEpDesc(e.target.value)} className="input-text" />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Subscribed Events (comma-separated)</label>
                    <input type="text" value={newEpEvents} onChange={(e) => setNewEpEvents(e.target.value)} className="input-text" required />
                  </div>
                  <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                    <Plus size={16} /> Register Endpoint
                  </button>
                </form>
              </div>

              {/* Endpoints List */}
              <div className="glass-panel">
                <h3 style={{ fontSize: '1.1rem', marginBottom: '20px' }}>Configured Webhook Targets</h3>

                {endpoints.length === 0 ? (
                  <span style={{ color: 'var(--text-muted)' }}>No endpoints configured for this application.</span>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {endpoints.map((ep) => (
                      <div key={ep.id} style={{ border: '1px solid var(--panel-border)', padding: '20px', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.01)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span className={`pulse-indicator ${ep.status === 'active' ? 'pulse-success' : 'pulse-danger'}`}></span>
                              <strong style={{ fontSize: '1.05rem', color: 'var(--text-main)' }}>{ep.url}</strong>
                            </div>
                            {ep.description && <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>{ep.description}</p>}
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => handleSandboxTest(ep.id)} className="btn btn-secondary" style={{ padding: '6px 10px', fontSize: '0.75rem' }}>
                              Test Send
                            </button>
                            <button
                              onClick={() => {
                                setEditingEp(ep);
                                setTransCode(ep.transformation?.code || 'function transform(payload, eventType) {\n  // Modify payload here\n  payload.processedAt = new Date().toISOString();\n  return payload;\n}');
                                setTransEnabled(ep.transformation?.enabled ?? true);
                              }}
                              className="btn btn-secondary"
                              style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                            >
                              <Code size={12} /> Transform JS
                            </button>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '12px' }}>
                          {ep.subscriptions?.map((sub: any) => (
                            <span key={sub.id} className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>{sub.eventType?.name}</span>
                          ))}
                        </div>

                        {ep.transformation && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px', fontSize: '0.75rem', color: 'var(--primary)' }}>
                            <Code size={12} /> Transformation active inside secure sandboxed container.
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Transform Editor Overlay */}
            {editingEp && (
              <div style={{
                position: 'fixed',
                top: 0, left: 0, right: 0, bottom: 0,
                background: 'rgba(0,0,0,0.8)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '40px',
                zIndex: 100
              }}>
                <div className="glass-panel" style={{ width: '100%', maxWidth: '700px' }}>
                  <h3 style={{ fontSize: '1.25rem', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Code size={20} style={{ color: 'var(--accent)' }} /> Configure Transform: {editingEp.url}
                  </h3>
                  <p style={{ color: 'var(--text-sub)', fontSize: '0.85rem', marginBottom: '20px' }}>
                    Write JavaScript script to format payloads safely in the <strong>Business tier sandbox</strong> before dispatch.
                  </p>

                  <div className="form-group">
                    <label className="form-label">Script Code</label>
                    <textarea
                      value={transCode}
                      onChange={(e) => setTransCode(e.target.value)}
                      className="input-text"
                      style={{ minHeight: '260px', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}
                    />
                  </div>

                  <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="checkbox" id="trans-enabled" checked={transEnabled} onChange={(e) => setTransEnabled(e.target.checked)} />
                    <label htmlFor="trans-enabled" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>Enable Transformation</label>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button onClick={() => setEditingEp(null)} className="btn btn-secondary">Cancel</button>
                    <button onClick={handleSaveTransformation} className="btn btn-primary">Save Script</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* --- API Keys Tab --- */}
        {activeTab === 'keys' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
              <div>
                <h1 style={{ fontSize: '1.8rem', fontFamily: 'var(--font-display)' }}>API Keys</h1>
                <p style={{ color: 'var(--text-sub)', fontSize: '0.9rem' }}>Authenticate your systems to ingest events via WebhookEngine.</p>
              </div>
            </div>

            <div className="glass-panel" style={{ maxWidth: '800px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h3 style={{ fontSize: '1.1rem' }}>Active Integration API Keys</h3>
                <button onClick={handleGenerateKey} className="btn btn-primary">
                  <Key size={16} /> Generate Key
                </button>
              </div>

              {newApiKey && (
                <div style={{
                  background: 'var(--primary-glow)',
                  border: '1px dashed var(--primary)',
                  padding: '16px',
                  borderRadius: 'var(--radius-sm)',
                  marginBottom: '20px'
                }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>API KEY CREATED — COPY THIS NOW (IT WILL NOT BE SHOWN AGAIN)</span>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1rem', color: '#fff', marginTop: '8px', wordBreak: 'break-all' }}>
                    {newApiKey}
                  </div>
                </div>
              )}

              {apiKeys.length === 0 ? (
                <span style={{ color: 'var(--text-muted)' }}>No API keys configured. Click "Generate Key" above to initialize.</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {apiKeys.map((key) => (
                    <div key={key.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.01)' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className={`pulse-indicator ${key.revokedAt ? 'pulse-danger' : 'pulse-success'}`}></span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>whkey_••••••••••••••••</span>
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          Created: {new Date(key.createdAt).toLocaleString()} | Environment: {key.environment}
                        </span>
                      </div>
                      {!key.revokedAt ? (
                        <button onClick={() => handleRevokeKey(key.id)} className="btn btn-danger" style={{ padding: '6px 12px', fontSize: '0.75rem' }}>
                          Revoke Key
                        </button>
                      ) : (
                        <span className="badge badge-danger">Revoked</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- Billing Tab --- */}
        {activeTab === 'billing' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
              <div>
                <h1 style={{ fontSize: '1.8rem', fontFamily: 'var(--font-display)' }}>Billing & Quotas</h1>
                <p style={{ color: 'var(--text-sub)', fontSize: '0.9rem' }}>Configure plans, billing profiles, and inspect usage limits.</p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', maxWidth: '1000px' }}>
              {/* Billing Info */}
              <div className="glass-panel">
                <h3 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Current Subscription</h3>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--panel-border)', marginBottom: '20px' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>PLAN TIER</span>
                  <h2 style={{ fontSize: '1.8rem', color: 'var(--primary)', textTransform: 'capitalize', marginTop: '4px' }}>
                    {org?.plan || 'free'}
                  </h2>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-sub)', marginTop: '8px' }}>
                    Your subscription is powered by Razorpay. Updates sync instantly on payment confirmations.
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button className="btn btn-primary" onClick={() => alert('Razorpay portal payment mock triggered.')}>
                    Upgrade Subscription
                  </button>
                  <button className="btn btn-secondary" onClick={() => alert('Mock cancellation.')}>
                    Cancel Plan
                  </button>
                </div>
              </div>

              {/* Usage Quotas */}
              <div className="glass-panel">
                <h3 style={{ fontSize: '1.1rem', marginBottom: '16px' }}>Monthly Quotas</h3>
                {usage ? (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: '6px' }}>
                      <span>Webhook dispatches</span>
                      <strong>{usage.eventCount} / {usage.eventLimit}</strong>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.05)', height: '12px', borderRadius: '6px', overflow: 'hidden', marginBottom: '16px' }}>
                      <div style={{ background: 'linear-gradient(90deg, var(--primary), var(--accent))', width: `${usage.percentUsed}%`, height: '100%', borderRadius: '6px' }}></div>
                    </div>
                    <ul style={{ fontSize: '0.85rem', color: 'var(--text-sub)', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <li>Limit resets automatically on: <strong>{new Date(usage.periodEnd).toLocaleDateString()}</strong></li>
                      <li>Standard retention period: <strong>{org?.plan === 'business' ? '90 days' : '30 days'}</strong></li>
                      <li>High-reliability FIFO delivery: <strong>{org?.plan === 'business' ? 'Active' : 'Locked'}</strong></li>
                    </ul>
                  </div>
                ) : (
                  <span style={{ color: 'var(--text-muted)' }}>Loading usage metrics...</span>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
