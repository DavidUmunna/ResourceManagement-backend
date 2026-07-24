const ExcelJS = require('exceljs');
const orderModel = require("./models/PurchaseOrder")
const { uploadBufferToCloud } = require("./googlecloudstorage.service");

// Function to export and upload Excel file to Google Cloud Storage
const exportToExcelAndUpload = async (Id) => {
  try {
    // Fetch your data (replace with actual MongoDB query)
    const orders = await orderModel.find({}).populate("staff","name email").lean();
    
    //console.log("the orders",orders)
    // Process the orders to create your Excel data
    const formattedData = orders.map((order)=>{
      return{orderNumber: order.orderNumber || "N/A",
      supplier: order.supplier || "N/A",
      email: order.staff.email || "N/A",
      status: order.status || "N/A",
      orderedBy: order.staff.name || "N/A",
      }
    });
    console.log("formatted data products:",formattedData.products)
    
    const productData = orders.flatMap(order =>
      order.products.map(item => ({
        orderNumber: order.orderNumber || "N/A", // Include orderNumber for reference
        name: item.name || "N/A",
        quantity: item.quantity || "N/A",
        price: item.price || "N/A"
      }))
    );
    // Create the Excel file in memory
    const workbook = new ExcelJS.Workbook();

    const ws = workbook.addWorksheet('orders');
    if (formattedData.length > 0) {
      ws.columns = Object.keys(formattedData[0]).map(key => ({ header: key, key }));
      ws.addRows(formattedData);
    }

    const ordersworksheet = workbook.addWorksheet('Request_data');
    if (productData.length > 0) {
      ordersworksheet.columns = Object.keys(productData[0]).map(key => ({ header: key, key }));
      ordersworksheet.addRows(productData);
    }

    // Write the workbook to a buffer (not to a file)
    const excelBuffer = await workbook.xlsx.writeBuffer();

    // Upload the file to Google Cloud Storage
    const cloudFile = await uploadBufferToCloud(
      excelBuffer,
      'orders.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    console.log('File uploaded successfully! Object name:', cloudFile.objectName);
  } catch (error) {
    console.error('Error exporting and uploading Excel file:', error);
  }
};

// Run the function
module.exports=exportToExcelAndUpload;
