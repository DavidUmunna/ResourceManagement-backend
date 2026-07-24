const orderModel = require("./models/PurchaseOrder");
const ExcelJS = require("exceljs");
const path = require("path");

const EXCEL_PATH = path.join(__dirname, "../orders.xlsx");

// Read all rows from an ExcelJS worksheet into plain objects using the header row
const sheetToJson = (worksheet) => {
  const rows = [];
  const headers = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      row.eachCell((cell, colNumber) => { headers[colNumber] = cell.value; });
    } else {
      const obj = {};
      row.eachCell((cell, colNumber) => { obj[headers[colNumber]] = cell.value; });
      rows.push(obj);
    }
  });
  return rows;
};

const exporttoExcel = async () => {
  try {
    const orders = await orderModel.find({}).populate("staff", "name Department email").lean();

    const workbook = new ExcelJS.Workbook();
    let existingOrdersData = [];
    let existingProductData = [];

    // Attempt to read the existing workbook
    try {
      await workbook.xlsx.readFile(EXCEL_PATH);
      const ordersSheet = workbook.getWorksheet("orders");
      const productSheet = workbook.getWorksheet("productdata");
      if (ordersSheet) existingOrdersData = sheetToJson(ordersSheet);
      if (productSheet) existingProductData = sheetToJson(productSheet);
    } catch (err) {
      // File doesn't exist yet — start fresh
    }

    // Create a Set of existing orderNumbers for quick lookup
    const existingOrderNumbers = new Set(existingOrdersData.map(order => order.orderNumber));

    // Filter out orders that already exist
    const newOrders = orders.filter(order => !existingOrderNumbers.has(order.orderNumber));

    if (newOrders.length === 0) {
      return;
    }

    // Format new orders and their products
    const formattedData = orders.map((order) => ({
      orderNumber: order.orderNumber || "N/A",
      supplier: order.supplier || "N/A",
      email: order.staff.email || "N/A",
      status: order.status || "N/A",
      orderedBy: order.staff.name || "N/A",
    }));

    const productData = newOrders.flatMap(order =>
      order.products.map(item => ({
        orderNumber: order.orderNumber || "N/A",
        name: item.name || "N/A",
        quantity: item.quantity || "N/A",
        price: item.price || "N/A",
      }))
    );

    // Append new data to existing data
    const updatedOrdersData = existingOrdersData.concat(formattedData);
    const updatedProductData = existingProductData.concat(productData);

    // Rebuild orders worksheet
    const existingOrdersSheet = workbook.getWorksheet("orders");
    if (existingOrdersSheet) workbook.removeWorksheet(existingOrdersSheet.id);
    const ordersSheet = workbook.addWorksheet("orders");
    if (updatedOrdersData.length > 0) {
      ordersSheet.columns = Object.keys(updatedOrdersData[0]).map(key => ({ header: key, key }));
      ordersSheet.addRows(updatedOrdersData);
    }

    // Rebuild productdata worksheet
    const existingProductSheet = workbook.getWorksheet("productdata");
    if (existingProductSheet) workbook.removeWorksheet(existingProductSheet.id);
    const productSheet = workbook.addWorksheet("productdata");
    if (updatedProductData.length > 0) {
      productSheet.columns = Object.keys(updatedProductData[0]).map(key => ({ header: key, key }));
      productSheet.addRows(updatedProductData);
    }

    // Write the updated workbook to file
    await workbook.xlsx.writeFile(EXCEL_PATH);
  } catch (err) {
    console.error("Error Exporting Data", err);
  }
};


module.exports=exporttoExcel;