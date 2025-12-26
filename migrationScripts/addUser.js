
const Users = require('../models/Users');
const mongoose = require('mongoose');


const addUserToPurchaseOrders = async () => {
    try {
        console.log("Starting migration to add user to PurchaseOrders...");
        // Find PurchaseOrders without the 'user' field
        const ordersToUpdate = await PurchaseOrders.find({ user: { $exists: false } }).select('_id createdBy');
        
        console.log(`Found ${ordersToUpdate.length} PurchaseOrders to update.`);
        for (const order of ordersToUpdate) {
            const user = await Users.findOne({ userId: order.createdBy }).select('_id');
            if (user) {
                order.user = user._id;
                await order.save();
                console.log(`Updated PurchaseOrder: ${order._id} with user: ${user._id}`);
            }
        }
        console.log("Migration completed!");
    }
    catch (error) {
        console.error("Error during migration:", error);
    }
}