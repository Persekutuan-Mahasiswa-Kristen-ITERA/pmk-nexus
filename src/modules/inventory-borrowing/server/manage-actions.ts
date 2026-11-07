"use server";

import "server-only";
import { getAccessState } from "@/lib/auth/session";
import {
  addInventoryListEntry,
  addInventoryStock,
  addInventoryUnits,
  createInventoryItem,
  moveInventoryStock,
  moveInventoryUnit,
  renameInventoryListEntry,
  restoreLostInventoryUnit,
  setInventoryItemActive,
  setInventoryListEntryActive,
  setInventoryUnitActive,
  setInventoryUnitCondition,
  updateInventoryItem,
  writeOffInventoryStock,
  writeOffInventoryUnit,
} from "@/lib/picore/inventory-borrowing";
import {
  itemCreateSchema,
  itemSetActiveSchema,
  itemUpdateSchema,
  listEntryAddSchema,
  listEntryRenameSchema,
  listEntrySetActiveSchema,
  stockAddSchema,
  stockMoveSchema,
  stockWriteOffSchema,
  unitAddSchema,
  unitConditionSchema,
  unitMoveSchema,
  unitRestoreSchema,
  unitSetActiveSchema,
  unitWriteOffSchema,
  type ChangeResult,
  type InventoryResult,
  type ItemCreateInput,
  type ItemCreateResult,
  type ItemSetActiveInput,
  type ItemUpdateInput,
  type ListEntryAddInput,
  type ListEntryRenameInput,
  type ListEntryResult,
  type ListEntrySetActiveInput,
  type StockAddInput,
  type StockAddResult,
  type StockMoveInput,
  type StockWriteOffInput,
  type UnitAddInput,
  type UnitAddResult,
  type UnitConditionInput,
  type UnitMoveInput,
  type UnitRestoreInput,
  type UnitSetActiveInput,
  type UnitWriteOffInput,
} from "../types";
import { requireInventory, type InventoryGate } from "./access";
import { parseInput, safely } from "./validation";

// Server Actions for inventory.manage (Operations by default): item, unit, stock and list changes.
// Each: session check (getAccessState) + inventory.manage first, zod validation, then ONE database
// function with the user's client (it checks the right, the active period and every business rule
// again, and writes an item history row). Never throws; returns InventoryResult<T>.

async function gate(): Promise<InventoryGate> {
  let state;
  try {
    state = await getAccessState();
  } catch {
    state = { kind: "error" } as const;
  }
  return requireInventory("canManageInventory", state);
}

export async function createItem(input: ItemCreateInput): Promise<InventoryResult<ItemCreateResult>> {
  return safely("createItem", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(itemCreateSchema, input);
    if (!parsed.ok) return parsed;
    return createInventoryItem(g.supabase, parsed.data);
  });
}

export async function updateItem(input: ItemUpdateInput): Promise<InventoryResult<ChangeResult>> {
  return safely("updateItem", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(itemUpdateSchema, input);
    if (!parsed.ok) return parsed;
    return updateInventoryItem(g.supabase, parsed.data);
  });
}

export async function addUnits(input: UnitAddInput): Promise<InventoryResult<UnitAddResult>> {
  return safely("addUnits", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(unitAddSchema, input);
    if (!parsed.ok) return parsed;
    return addInventoryUnits(g.supabase, parsed.data);
  });
}

export async function moveUnit(input: UnitMoveInput): Promise<InventoryResult<ChangeResult>> {
  return safely("moveUnit", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(unitMoveSchema, input);
    if (!parsed.ok) return parsed;
    return moveInventoryUnit(g.supabase, parsed.data);
  });
}

export async function addStock(input: StockAddInput): Promise<InventoryResult<StockAddResult>> {
  return safely("addStock", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(stockAddSchema, input);
    if (!parsed.ok) return parsed;
    return addInventoryStock(g.supabase, parsed.data);
  });
}

export async function moveStock(input: StockMoveInput): Promise<InventoryResult<null>> {
  return safely("moveStock", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(stockMoveSchema, input);
    if (!parsed.ok) return parsed;
    return moveInventoryStock(g.supabase, parsed.data);
  });
}

export async function writeOffStock(input: StockWriteOffInput): Promise<InventoryResult<null>> {
  return safely("writeOffStock", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(stockWriteOffSchema, input);
    if (!parsed.ok) return parsed;
    return writeOffInventoryStock(g.supabase, parsed.data);
  });
}

export async function setUnitCondition(input: UnitConditionInput): Promise<InventoryResult<null>> {
  return safely("setUnitCondition", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(unitConditionSchema, input);
    if (!parsed.ok) return parsed;
    return setInventoryUnitCondition(g.supabase, parsed.data);
  });
}

export async function writeOffUnit(input: UnitWriteOffInput): Promise<InventoryResult<null>> {
  return safely("writeOffUnit", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(unitWriteOffSchema, input);
    if (!parsed.ok) return parsed;
    return writeOffInventoryUnit(g.supabase, parsed.data);
  });
}

export async function restoreLostUnit(input: UnitRestoreInput): Promise<InventoryResult<null>> {
  return safely("restoreLostUnit", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(unitRestoreSchema, input);
    if (!parsed.ok) return parsed;
    return restoreLostInventoryUnit(g.supabase, parsed.data);
  });
}

export async function setItemActive(input: ItemSetActiveInput): Promise<InventoryResult<ChangeResult>> {
  return safely("setItemActive", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(itemSetActiveSchema, input);
    if (!parsed.ok) return parsed;
    return setInventoryItemActive(g.supabase, parsed.data);
  });
}

export async function setUnitActive(input: UnitSetActiveInput): Promise<InventoryResult<ChangeResult>> {
  return safely("setUnitActive", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(unitSetActiveSchema, input);
    if (!parsed.ok) return parsed;
    return setInventoryUnitActive(g.supabase, parsed.data);
  });
}

export async function addListEntry(input: ListEntryAddInput): Promise<InventoryResult<ListEntryResult>> {
  return safely("addListEntry", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(listEntryAddSchema, input);
    if (!parsed.ok) return parsed;
    return addInventoryListEntry(g.supabase, parsed.data.kind, parsed.data.name);
  });
}

export async function renameListEntry(input: ListEntryRenameInput): Promise<InventoryResult<ListEntryResult>> {
  return safely("renameListEntry", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(listEntryRenameSchema, input);
    if (!parsed.ok) return parsed;
    return renameInventoryListEntry(g.supabase, parsed.data.kind, parsed.data.id, parsed.data.name);
  });
}

export async function setListEntryActive(input: ListEntrySetActiveInput): Promise<InventoryResult<ListEntryResult>> {
  return safely("setListEntryActive", async () => {
    const g = await gate();
    if (!g.ok) return g;
    const parsed = parseInput(listEntrySetActiveSchema, input);
    if (!parsed.ok) return parsed;
    return setInventoryListEntryActive(g.supabase, parsed.data.kind, parsed.data.id, parsed.data.isActive);
  });
}
