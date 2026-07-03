import { EventIngestSchema } from '@webhookengine/shared';

export interface WebhookEngineConfig {
  apiKey: string;
  appId: string;
  baseUrl?: string;
}

export class WebhookEngine {
  private apiKey: string;
  private appId: string;
  private baseUrl: string;

  constructor(config: WebhookEngineConfig) {
    this.apiKey = config.apiKey;
    this.appId = config.appId;
    this.baseUrl = config.baseUrl || 'http://localhost:3000';
  }

  public events = {
    create: async (data: { eventType: string; payload: Record<string, any>; idempotencyKey?: string }) => {
      // Validate schema
      const validated = EventIngestSchema.parse(data);

      const response = await fetch(`${this.baseUrl}/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'x-app-id': this.appId
        },
        body: JSON.stringify(validated)
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || 'Failed to dispatch webhook event');
      }

      return body as {
        message: string;
        eventId: string;
        deliveriesCount: number;
      };
    }
  };
}
