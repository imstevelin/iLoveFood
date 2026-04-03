import { Injectable } from '@angular/core';
import { BaseTool } from './base.tool';
import { StoreSearchTool } from './store-search.tool';
import { InventoryQueryTool } from './inventory-query.tool';
import { NearbyStoresTool } from './nearby-stores.tool';
import { LocationSearchTool } from './location-search.tool';

@Injectable({
  providedIn: 'root'
})
export class ToolRegistryService {
  private tools = new Map<string, BaseTool>();

  constructor(
    private storeSearchTool: StoreSearchTool,
    private inventoryQueryTool: InventoryQueryTool,
    private nearbyStoresTool: NearbyStoresTool,
    private locationSearchTool: LocationSearchTool
  ) {
    this.register(this.storeSearchTool);
    this.register(this.inventoryQueryTool);
    this.register(this.nearbyStoresTool);
    this.register(this.locationSearchTool);
  }

  private register(tool: BaseTool) {
    this.tools.set(tool.definition.name, tool);
  }

  getTool(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  getAllDefinitions(): any[] {
    return Array.from(this.tools.values()).map(tool => ({
      type: 'function',
      function: tool.definition
    }));
  }
}
