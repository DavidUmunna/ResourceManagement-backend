require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const AssetItem = require('../models/Assets');

const MONGO_URI = process.env.MONGO_URI || "mongodb://AppUser:Haldenng123@127.0.0.1:27017/Haldenresources?authSource=admin";
const FILE_PATH = './WASTE MGT ASSETS.xlsx';
const SHEET_NAME = 'WASTE MGT ELELENWO';

function generateSKU(name, index) {
  const prefix = name.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X').padEnd(3, 'X');
  return `${prefix}-${Date.now()}-${index}`;
}

function mapCondition(status) {
  if (!status) return 'OK';
  const s = String(status).toLowerCase();
  if (s.includes('fault')) return 'Damaged';
  if (s.includes('fair') || s.includes('used')) return 'Used';
  return 'OK';
}

function mapCategory(assetType, description, subLocation) {
  const text = [assetType, description, subLocation]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/laptop|computer|tv|smart tv|plc|monitor/.test(text)) return 'IT_equipment';
  if (/table|chair|bed|shelf|fridge|fan|board|sofa|couch|cabinet|locker/.test(text)) return 'Furniture';
  return 'waste_management';
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'string') {
    // handle dd.mm.yyyy
    const ddmmyyyy = val.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (ddmmyyyy) {
      return new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2,'0')}-${ddmmyyyy[1].padStart(2,'0')}`);
    }
    const d = new Date(val);
    if (!isNaN(d)) return d;
  }
  if (typeof val === 'number') {
    // Excel date serial
    const d = new Date((val - 25569) * 86400 * 1000);
    if (!isNaN(d)) return d;
  }
  return null;
}

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE_PATH);
  const ws = wb.getWorksheet(SHEET_NAME);

  if (!ws) {
    console.error(`Sheet "${SHEET_NAME}" not found`);
    process.exit(1);
  }

  let currentAssetType = null;
  let currentSubLocation = 'ELELENWO';
  const assets = [];

  ws.eachRow((row, rowNum) => {
    if (rowNum <= 3) return; // skip title + header rows

    const v = row.values; // 1-indexed
    const col1 = v[1] != null ? String(v[1]).trim() : null;  // ASSET TYPE
    const col2 = v[2] != null ? String(v[2]).trim() : null;  // DESCRIPTION
    const col3 = v[3];                                         // QTY
    const col4 = v[4] != null ? String(v[4]).trim() : null;  // LOCATION/DEPT
    const col5 = v[5];                                         // DATE
    const col6 = v[6] != null ? String(v[6]).trim() : null;  // STATUS
    const col7 = v[7];                                         // FAIR VALUE NGN

    // Track current asset type from col1 (skip placeholder '"')
    if (col1 && col1 !== '"') {
      currentAssetType = col1;
    }

    if (!col2) return;

    const hasQty   = col3 !== null && col3 !== undefined && col3 !== '';
    const hasValue = col7 !== null && col7 !== undefined && col7 !== '';

    // Rows with no qty and no value are section/subsection labels
    if (!hasQty && !hasValue) {
      currentSubLocation = col2;
      return;
    }

    const qty       = Number(col3) || 1;
    const fairValue = Number(col7) || 0;
    const condition = mapCondition(col6);
    const category  = mapCategory(currentAssetType, col2, currentSubLocation);
    // Only use an explicit col4 value as location; everything else defaults to the site name.
    // col4 = '"' means "same as above" in the spreadsheet — not a real location string.
    const location  = (col4 && col4 !== '"') ? col4 : 'ELELENWO';
    const date      = parseDate(col5);

    // Prefix the name with asset type for clarity when it differs from subLocation
    const displayName = col2.substring(0, 100);
    const descParts = [currentAssetType, col2].filter(Boolean);
    const description = [...new Set(descParts)].join(' — ').substring(0, 500);

    // For waste_management assets, capture the Excel asset type as subCategory
    // (e.g. "PLANT AND MACHINERY", "TDU EQUIPMENTS", "GENERATORS", "TRUCKS", etc.)
    const subCategory = (category === 'waste_management' && currentAssetType)
      ? currentAssetType
      : null;

    assets.push({
      name:        displayName,
      category,
      condition,
      sku:         generateSKU(col2, assets.length),
      quantity:    qty,
      value:       fairValue,
      description,
      location:    location.substring(0, 100),
      lastUpdated: date || new Date(),
      active:      condition !== 'Damaged',
      ...(subCategory && { subCategory }),
    });
  });

  console.log(`Parsed ${assets.length} asset records from Excel`);

  if (assets.length === 0) {
    console.log('Nothing to insert.');
    await mongoose.connection.close();
    return;
  }

  // Preview first 3
  console.log('\nSample records:');
  assets.slice(0, 3).forEach((a, i) =>
    console.log(`  [${i + 1}] ${a.name} | cat:${a.category} | qty:${a.quantity} | value:${a.value} | cond:${a.condition}`)
  );

  const result = await AssetItem.insertMany(assets, { ordered: false });
  console.log(`\nInserted ${result.length} assets successfully`);

  await mongoose.connection.close();
  console.log('Done.');
}

run().catch(err => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
