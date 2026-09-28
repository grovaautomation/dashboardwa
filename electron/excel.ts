import path from 'path';
import { normalizePhone } from './db';
import type { ImportPreview } from '../shared/types';

export async function readExcel(filePath:string,sheetName?:string):Promise<ImportPreview>{
  const {default:readXlsxFile}=await import('read-excel-file/node');const workbook=await readXlsxFile(filePath);const sheets=workbook.map(item=>item.sheet);const selectedSheet=sheetName&&sheets.includes(sheetName)?sheetName:(sheets.includes('Valid Leads')?'Valid Leads':sheets[0]);if(!selectedSheet)throw new Error('Workbook tidak memiliki sheet');
  const table=workbook.find(item=>item.sheet===selectedSheet)?.data||[];const headerRow=table[0]||[];const headers=headerRow.map((cell,index)=>String(cell??'').trim()||`Kolom ${index+1}`);
  const rows:Record<string,string>[]=[];table.slice(1).forEach(row=>{const record:Record<string,string>={};headers.forEach((h,i)=>record[h]=String(row[i]??'').trim());if(Object.values(record).some(Boolean))rows.push(record)});
  const find=(candidates:string[])=>headers.find(h=>candidates.some(c=>h.toLowerCase()===c))||'';
  const suggestedMapping={business:find(['business name','businessname','nama bisnis','nama_bisnis','name']),phone:find(['primary whatsapp','whatsapp','phone','nomor whatsapp']),wa_exists:find(['wa exists']),confidence:find(['confidence'])};
  const seen=new Set<string>();let missing=0,missingBusiness=0,duplicates=0,ready=0;rows.forEach(r=>{const business=String(r[suggestedMapping.business]||'').trim();const p=normalizePhone(r[suggestedMapping.phone]||'');if(!business)missingBusiness++;if(!p)missing++;else if(seen.has(p))duplicates++;else{seen.add(p);if(business)ready++}});
  return {filePath,fileName:path.basename(filePath),sheets,selectedSheet,headers,suggestedMapping,rows,summary:{total:rows.length,ready,missing,missingBusiness,duplicates}};
}
