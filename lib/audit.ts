import { supabase } from './supabase';

export type ActorType = 'user' | 'system' | 'agent' | 'admin' | 'webhook';

export async function writeAuditLog(params: {
  actorType: ActorType;
  actorId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}) {
  const { error } = await supabase.from('audit_logs').insert({
    actor_type: params.actorType,
    actor_id: params.actorId || null,
    action: params.action,
    resource_type: params.resourceType,
    resource_id: params.resourceId || null,
    details: params.details || {},
    ip_address: params.ipAddress || null,
  });

  if (error) {
    console.error('Failed to write audit log:', error);
  }
}
