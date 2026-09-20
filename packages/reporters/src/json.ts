import type {ReportView} from './report-view.js';
export function renderJson(view:ReportView):string{return JSON.stringify(view,null,2)+'\n';}
