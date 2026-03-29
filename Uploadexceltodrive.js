const { google } = require('googleapis');
const fs = require('fs');
const XLSX = require('xlsx');
const path = require('path');
const readline = require('readline');
const orderModel = require("./models/PurchaseOrder")
const { Readable } = require('stream');
const { getOverlappingDaysInIntervals } = require('date-fns');

// Authenticate using the service account
const authenticateGoogleDrive = async () => {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, "./google-service-account.json"), // Path to the service account key
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  const authClient = await auth.getClient();
  const drive = google.drive({ version: 'v3', auth: authClient });
  return drive;
};

// Function to export and upload Excel file to Google Drive
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
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(formattedData);
    const ordersworksheet=XLSX.utils.json_to_sheet(productData)
   
    XLSX.utils.book_append_sheet(wb, ws, "orders");
    XLSX.utils.book_append_sheet(wb, ordersworksheet, "Request_data");

    // Write the workbook to a buffer (not to a file)
    const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });

    // Authenticate to Google Drive
    const drive = await authenticateGoogleDrive();

    // Define file metadata for Google Drive
    const fileMetadata = {
      name: 'orders.xlsx',
      parents: ['109wtlBgstJ9PSfFKLQccTp2uW7T_imcC'], // Specify the folder ID you want to upload the file to
    };

    // Upload the file to Google Drive
    const media = {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: Readable.from(excelBuffer),
    };

    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id',
    });

    console.log('File uploaded successfully! File ID:', file.data.id);
  } catch (error) {
    console.error('Error exporting and uploading Excel file:', error);
  }
};

// Run the function
module.exports=exportToExcelAndUpload;
