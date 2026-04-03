import { Observable } from 'rxjs';

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: any;
}

export abstract class BaseTool {
  /**
   * The tool's schema definition to be sent to the LLM.
   */
  abstract get definition(): ToolDefinition;

  /**
   * The text to display to the user while the tool is executing.
   */
  abstract get loadingMessage(): string;

  /**
   * Executes the tool's action.
   * @param args Arguments parsed from the LLM tool call.
   */
  abstract execute(args: any): Observable<any>;
}
