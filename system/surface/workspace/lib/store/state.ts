import type { StoreItem } from './catalog';
import * as runtime from './state.mjs';

/** Session-only demo state for the Store library and operations. Requests never become results by themselves. */
export type ItemStatus =
  | 'available' | 'installed' | 'update-available' | 'informational'
  | 'disconnected' | 'authorization-required' | 'connected' | 'unavailable'
  | 'disabled' | 'enabled';
export type OpKind = 'install' | 'update' | 'remove' | 'connect' | 'disconnect' | 'enable' | 'disable' | 'apply';
export type OpState = 'requested' | 'accepted' | 'running' | 'succeeded' | 'failed' | 'blocked';
export type Operation = { id: string; itemId: string; op: OpKind; state: OpState; message: string };
export type StoreState = { status: Record<string, ItemStatus>; ops: Operation[]; favorites: string[]; history: string[] };
export type StoreAction =
  | { type: 'request'; itemId: string; op: OpKind; id: string }
  | { type: 'advance'; id: string }
  | { type: 'authorize'; itemId: string; approve: boolean }
  | { type: 'favorite'; itemId: string }
  | { type: 'visit'; itemId: string }
  | { type: 'dismiss'; id: string };

// Typed facade over the single shared session-only reducer.
export const DEMO_FAILING = runtime.DEMO_FAILING as Set<string>;
export const UNAVAILABLE_DEPENDENCIES = runtime.UNAVAILABLE_DEPENDENCIES as Set<string>;
export const initialStore = runtime.initialStore as StoreState;
export const defaultStatus = runtime.defaultStatus as (item: StoreItem) => ItemStatus;
export const statusOf = runtime.statusOf as (state: StoreState, item: StoreItem) => ItemStatus;
export const blockReason = runtime.blockReason as (item: StoreItem, operation: OpKind) => string | null;
export const storeReducer = runtime.storeReducer as (state: StoreState, action: StoreAction) => StoreState;
export const activeOps = runtime.activeOps as (state: StoreState) => Operation[];
export const updatable = runtime.updatable as (state: StoreState) => string[];
