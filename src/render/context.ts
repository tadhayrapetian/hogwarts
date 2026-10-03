import type { AppSettings, Asset, Character, House, Postmark, Seal, Stamp } from '../core/types';
import type { VarContext } from '../core/template';
import type { MeasureFn } from './textLayout';

/** Everything a renderer may need to resolve references inside a layout. */
export interface RenderLib {
  stamps: Map<string, Stamp>;
  postmarks: Map<string, Postmark>;
  seals: Map<string, Seal>;
  houses: Map<string, House>;
  houseList: House[];
  characters: Map<string, Character>;
  assets: Map<string, Asset>;
  settings?: AppSettings | null;
}

export interface RenderRefs {
  stampId?: string;
  postmarkId?: string;
  sealId?: string;
  senderId?: string;
  houseId?: string;
  postmarkDate?: string;
  shipDate?: string;
}

export interface RenderCtx {
  vars: VarContext;
  lib: RenderLib;
  refs: RenderRefs;
  idPrefix: string;
  locale?: string;
  measure?: MeasureFn;
  /** Editor mode: show placeholders for unresolved references and overflow outlines. */
  editor?: boolean;
}

export function emptyLib(): RenderLib {
  return {
    stamps: new Map(),
    postmarks: new Map(),
    seals: new Map(),
    houses: new Map(),
    houseList: [],
    characters: new Map(),
    assets: new Map(),
  };
}

export function buildLib(input: {
  stamps?: Stamp[];
  postmarks?: Postmark[];
  seals?: Seal[];
  houses?: House[];
  characters?: Character[];
  assets?: Asset[];
  settings?: AppSettings | null;
}): RenderLib {
  return {
    stamps: new Map((input.stamps ?? []).map((x) => [x.id, x])),
    postmarks: new Map((input.postmarks ?? []).map((x) => [x.id, x])),
    seals: new Map((input.seals ?? []).map((x) => [x.id, x])),
    houses: new Map((input.houses ?? []).map((x) => [x.id, x])),
    houseList: input.houses ?? [],
    characters: new Map((input.characters ?? []).map((x) => [x.id, x])),
    assets: new Map((input.assets ?? []).map((x) => [x.id, x])),
    settings: input.settings,
  };
}

export function resolveSeal(ref: string, ctx: RenderCtx): Seal | undefined {
  const { lib, refs } = ctx;
  if (ref === '$project') return refs.sealId ? lib.seals.get(refs.sealId) : undefined;
  if (ref === '$house') {
    const h = refs.houseId ? lib.houses.get(refs.houseId) : undefined;
    return h?.sealId ? lib.seals.get(h.sealId) : undefined;
  }
  if (ref === '$sender') {
    const c = refs.senderId ? lib.characters.get(refs.senderId) : undefined;
    return c?.sealId ? lib.seals.get(c.sealId) : undefined;
  }
  return lib.seals.get(ref);
}

export function resolveStamp(ref: string, ctx: RenderCtx): Stamp | undefined {
  return ref === '$project' ? (ctx.refs.stampId ? ctx.lib.stamps.get(ctx.refs.stampId) : undefined) : ctx.lib.stamps.get(ref);
}

export function resolvePostmark(ref: string, ctx: RenderCtx): Postmark | undefined {
  return ref === '$project' ? (ctx.refs.postmarkId ? ctx.lib.postmarks.get(ctx.refs.postmarkId) : undefined) : ctx.lib.postmarks.get(ref);
}

export function resolveCharacter(ref: string, ctx: RenderCtx): Character | undefined {
  return ref === '$sender' ? (ctx.refs.senderId ? ctx.lib.characters.get(ctx.refs.senderId) : undefined) : ctx.lib.characters.get(ref);
}

export function resolveHouse(ref: string, ctx: RenderCtx): House | undefined | 'school' {
  if (ref === '$school') return 'school';
  if (ref === '$recipient') return ctx.refs.houseId ? ctx.lib.houses.get(ctx.refs.houseId) : undefined;
  return ctx.lib.houses.get(ref);
}
