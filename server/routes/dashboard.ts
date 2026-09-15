/**
 * 数据看板路由
 */
import { Router } from 'express';
import * as db from '../db.js';
import config from '../config.js';
import { getAdapter } from '../adapters/index.js';
import { getSummaryProviderStatus } from '../summary/provider.js';
import { getEventClientCount } from './events.js';

export const dashboardRouter = Router();

dashboardRouter.get('/', (_req, res) => {
  const adapter = getAdapter();
  const accounts = adapter.getAccounts();
  const ai = getSummaryProviderStatus();
  const stats = db.getDashboardStats();
  res.json({
    stats: { ...stats, connectedAccounts: accounts.filter((account) => account.status === 'connected').length },
    adapter: {
      kind: config.adapter,
      platform: adapter.platform,
      status: adapter.getStatus(),
      selfId: adapter.getSelfId(),
      accounts,
    },
    aiConfigured: ai.configured,
    aiProvider: ai.provider,
    sseClients: getEventClientCount(),
    timezone: config.timezone,
  });
});
