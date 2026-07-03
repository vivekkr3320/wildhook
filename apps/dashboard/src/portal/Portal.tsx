import React, { useState, useEffect } from 'react';
import { RefreshCw, Play, Plus, Server, Code, CheckCircle, AlertTriangle } from 'lucide-react';

interface PortalProps {
  token: string;
}

export default function Portal({ token }: PortalProps) {
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Create Endpoint Form
  const [showAdd, setShowAdd] = useState(false);
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [eventTypes, setEventTypes] = useState('user.created, user.updated');

  const fetchData = async () => {
    setError('');
    try {
      const headers = { 'Authorization': `Bearer ${token}` };

      const epRes = await fetch('/v1/portal/endpoints', { headers });
      if (!epRes.ok) throw new Error('Failed to load endpoints');
      const epData = await epRes.json();
      setEndpoints(epData);

      const delRes = await fetch('/v1/portal/deliveries', { headers });
      if (!delRes.ok) throw new Error('Failed to load logs');
      const delData = await delRes.json();
      setDeliveries(delData);

    } catch (err: any) {
      setError(err.message || 'Failed to sync portal data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token]);

  const handleCreateEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const response = await fetch('/v1/portal/endpoints', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url,
          description,
          eventTypes: eventTypes.split(',').map((t) => t.trim())
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Failed to create endpoint');
      }

      setUrl('');
      setDescription('');
      setShowAdd(false);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleReplay = async (deliveryId: string) => {
    try {
      // Replaying requires dashboard-level auth OR customer portal scope.
      // Wait, since we are in portal, we can map `/v1/deliveries/:id/replay` or we can let them replay.
      // Let's call /v1/deliveries/:id/replay. But wait! The portal session JWT is used for verification.
      // Let's see: we should make sure portal session JWT has access to replay scoped deliveries.
      // In apps/api/src/routes/endpoints.ts we wrote:
      // `router.post('/deliveries/:id/replay', authenticateUser ...)`
      // Wait! If the portal customer wants to replay, they can call a portal-specific replay endpoint or we can allow it.
      // Let's check: does `/v1/portal/deliveries/:id/replay` exist? Let's add it to apps/api/src/routes/portal.ts if not, or write it.
      // Wait! Let's check `apps/api/src/routes/portal.ts`. It doesn't have a replay route yet. Let's add one to make it perfectly work!
      // In the portal client, we'll call `/v1/portal/deliveries/${deliveryId}/replay` and we'll implement it in `portal.ts` as well.
      const response = await fetch(`/v1/portal/deliveries/${deliveryId}/replay`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
        throw new Error('Failed to replay webhook');
      }

      alert('Webhook delivery re-enqueued successfully!');
      fetchData();
    } catch (err: any) {
      alert(err.message);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'var(--text-sub)' }}>
        <RefreshCw className="pulse-indicator" size={24} style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ marginLeft: '12px' }}>Loading Integration Portal...</span>
      </div>
    );
  }

  return (
    <div style={{ padding: '40px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server style={{ color: 'var(--primary)' }} />
            <h1 style={{ fontSize: '1.8rem', fontFamily: 'var(--font-display)' }}>Developer Webhooks</h1>
          </div>
          <p style={{ color: 'var(--text-sub)', fontSize: '0.9rem', marginTop: '4px' }}>
            Configure endpoints and inspect live webhook logs for your integration.
          </p>
        </div>
        <button onClick={fetchData} className="btn btn-secondary">
          <RefreshCw size={16} /> Sync Logs
        </button>
      </div>

      {error && (
        <div style={{ background: 'var(--danger-glow)', border: '1px solid rgba(239, 68, 68, 0.2)', color: 'var(--danger)', padding: '16px', borderRadius: 'var(--radius-sm)', marginBottom: '24px' }}>
          {error}
        </div>
      )}

      {/* Endpoints Management */}
      <div className="glass-panel" style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Code size={20} style={{ color: 'var(--accent)' }} /> Destination Endpoints
          </h2>
          <button onClick={() => setShowAdd(!showAdd)} className="btn btn-primary btn-sm">
            <Plus size={16} /> {showAdd ? 'Close' : 'Add Endpoint'}
          </button>
        </div>

        {showAdd && (
          <form onSubmit={handleCreateEndpoint} style={{ background: 'rgba(0,0,0,0.15)', padding: '20px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--panel-border)', marginBottom: '20px' }}>
            <div className="form-group">
              <label className="form-label">Endpoint Destination URL</label>
              <input type="url" placeholder="https://api.yourdomain.com/webhooks" value={url} onChange={(e) => setUrl(e.target.value)} className="input-text" required />
            </div>
            <div className="form-group">
              <label className="form-label">Description (optional)</label>
              <input type="text" placeholder="Local development / Production sink" value={description} onChange={(e) => setDescription(e.target.value)} className="input-text" />
            </div>
            <div className="form-group">
              <label className="form-label">Subscribed Event Types (comma-separated)</label>
              <input type="text" placeholder="user.created, order.paid" value={eventTypes} onChange={(e) => setEventTypes(e.target.value)} className="input-text" required />
            </div>
            <button type="submit" className="btn btn-primary">Save Endpoint</button>
          </form>
        )}

        {endpoints.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
            No webhook endpoints registered. Click "Add Endpoint" above to register your first destination.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
            {endpoints.map((ep) => (
              <div key={ep.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', border: '1px solid var(--panel-border)', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.01)' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span className={`pulse-indicator ${ep.status === 'active' ? 'pulse-success' : 'pulse-danger'}`}></span>
                    <strong style={{ fontSize: '1rem', color: 'var(--text-main)' }}>{ep.url}</strong>
                    <span className="badge badge-neutral" style={{ fontSize: '0.7rem' }}>{ep.status}</span>
                  </div>
                  {ep.description && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px' }}>{ep.description}</p>}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                    {ep.subscriptions?.map((sub: any) => (
                      <span key={sub.id} className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>{sub.eventType?.name}</span>
                    ))}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Secret Key</span>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text-sub)', background: 'rgba(0,0,0,0.2)', padding: '6px 12px', borderRadius: '4px', border: '1px solid var(--panel-border)', marginTop: '4px' }}>
                    {ep.secret}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Webhook Delivery Logs */}
      <div className="glass-panel">
        <h2 style={{ fontSize: '1.25rem', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <RefreshCw size={20} style={{ color: 'var(--primary)' }} /> Webhook Delivery History
        </h2>

        {deliveries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
            No webhook event logs recorded yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="custom-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Event</th>
                  <th>Status</th>
                  <th>Destination</th>
                  <th>Code</th>
                  <th>Duration</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((log) => (
                  <tr key={log.id}>
                    <td>{new Date(log.createdAt).toLocaleString()}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{log.event?.eventType?.name}</td>
                    <td>
                      <span className={`badge ${log.status === 'success' ? 'badge-success' : 'badge-danger'}`}>
                        {log.status === 'success' ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                        {log.status}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.85rem' }}>{log.endpoint?.url}</td>
                    <td>
                      {log.responseCode ? (
                        <span style={{ color: log.responseCode < 300 ? 'var(--success)' : 'var(--danger)' }}>
                          {log.responseCode}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>-</span>
                      )}
                    </td>
                    <td>{log.durationMs}ms</td>
                    <td>
                      <button onClick={() => handleReplay(log.id)} className="btn btn-secondary" style={{ padding: '6px 10px', fontSize: '0.75rem' }}>
                        <Play size={12} /> Replay
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
