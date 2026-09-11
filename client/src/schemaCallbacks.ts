import type { Room } from "colyseus.js";
import { getDecoderStateCallbacks } from "@colyseus/schema";

export interface DecodableMap<V> {
  onAdd(callback: (item: V, key?: string) => void, triggerAll?: boolean): void;
  onRemove(callback: (item: V, key?: string) => void): void;
  onChange(callback: (item: V, key?: string) => void): void;
}

export interface DecodableArray<V> {
  onAdd(callback: (item: V, key?: number) => void, triggerAll?: boolean): void;
  onRemove(callback: (item: V, key?: number) => void): void;
  onChange(callback: (item: V, key?: number) => void): void;
}

const decoderAccessors = new WeakMap<Room<unknown>, (state: unknown) => Record<PropertyKey, unknown>>();

function getDecoderFor<TState>(room: Room<TState>) {
  let $ = decoderAccessors.get(room as Room<unknown>);
  if (!$) {
    const serializer = (room as unknown as { serializer: { decoder: unknown } }).serializer;
    const makeAccessor = getDecoderStateCallbacks(serializer.decoder as never);
    $ = (state: unknown) => makeAccessor(state) as Record<PropertyKey, unknown>;
    decoderAccessors.set(room as Room<unknown>, $);
  }
  return $;
}

export function getMapCallbacks<TState, TKey extends keyof TState, TItem>(
  room: Room<TState>,
  field: TKey,
): DecodableMap<TItem> {
  const callbacks = getDecoderFor(room)(room.state)[field];
  const deco = callbacks as DecodableMap<TItem>;
  if (!deco || typeof deco.onAdd !== "function") {
    throw new Error(`schema callback proxy unavailable for field '${String(field)}'`);
  }
  return deco;
}

export function getArrayCallbacks<TState, TKey extends keyof TState, TItem>(
  room: Room<TState>,
  field: TKey,
): DecodableArray<TItem> {
  const callbacks = getDecoderFor(room)(room.state)[field];
  const deco = callbacks as DecodableArray<TItem>;
  if (!deco || typeof deco.onAdd !== "function") {
    throw new Error(`schema callback proxy unavailable for field '${String(field)}'`);
  }
  return deco;
}

export interface SchemaInstanceCallbacks {
  onChange(callback: (value: unknown, previousValue: unknown) => void): void;
}

export function getInstanceCallbacks<TState>(room: Room<TState>, instance: unknown): SchemaInstanceCallbacks {
  return getDecoderFor(room)(instance) as unknown as SchemaInstanceCallbacks;
}