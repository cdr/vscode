import * as http from 'http';
import { IServerWorkbenchConstructionOptions } from 'vs/workbench/workbench.web.api';

export function requestHandler(req: http.IncomingMessage, res: http.ServerResponse, webConfigJSON: IServerWorkbenchConstructionOptions): void;
