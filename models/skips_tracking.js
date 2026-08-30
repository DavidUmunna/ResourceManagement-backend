const mongoose=require("mongoose")



const SkipsTrackingSchema=mongoose.Schema({
    skip_id:{type:String,required:true},
    DeliveryWaybillNo:{type:Number},
    DateMobilized:{type:Date},
    DateReceivedOnLocation:{type:Date},
    SkipsTruckRegNo:{type:String},
    SkipsTruckDriver:{type:String},
    Quantity: {
        value: { type: Number,  }, // e.g., 1500
        unit: {
          type: String,
          
        }
      },
    WasteStream:{type:String,required:true,enum:["WBM_Affluent","OBM_Cutting","WBM_cutting", "OBM_Affluent","Sludge","Others"]},
    WasteSource:{type:String,required:true},
    DispatchManifestNo:{type:String},
    WasteTruckRegNo:{type:String},
    WasteTruckDriverName:{type:String},
    
    DemobilizationOfFilledSkips:{type:Date},
    DateFilled:{type:Date},
    lastUpdated: {
    type: Date,
    default: Date.now
    },

    // ── RFID Skip Tracking (relational additions) ──────────────────────────────
    // RFID tag bound to this physical skip. Sparse+unique so many skips can be
    // tag-less, but no two ACTIVE skips share a tag (uniqueness enforced here for
    // the whole collection; the service additionally guards active-vs-active — FR-8).
    rfidTag: { type: String, trim: true, index: true },

    // Per-leg truck assignment (FR-2 / FR-5). Delivery = mobilization (empty skip
    // out to site), Collection = demobilization (filled skip back).
    assignedDeliveryTruckId:    { type: mongoose.Schema.Types.ObjectId, ref: "truck" },
    assignedDeliveryAssignedAt: { type: Date },
    assignedCollectionTruckId:    { type: mongoose.Schema.Types.ObjectId, ref: "truck" },
    assignedCollectionAssignedAt: { type: Date },

    // How each leg's scan was recorded — rfid (gate) vs manual (supervisor override).
    mobilizeScanMethod:   { type: String, enum: ["rfid", "manual"] },
    mobilizeManualReason: { type: String },
    demobilizeScanMethod:   { type: String, enum: ["rfid", "manual"] },
    demobilizeManualReason: { type: String },

    // Ownership / rental (FR-12, FR-16, Phase 6).
    ownership:          { type: String, enum: ["owned", "rented"], default: "owned" },
    rentedFromCompany:  { type: String },
    // Operational project this skip is deployed to (which project is this skip for).
    projectId:          { type: mongoose.Schema.Types.ObjectId, ref: "project" },
    projectRef:         { type: String }, // legacy free-text; superseded by projectId
    // Optional per-skip daily USD rate override. When set, it takes precedence
    // over the project's dailyRateUsd for this skip's revenue.
    dailyRateUsdOverride: { type: Number, min: 0, default: null },
    rentalStart:        { type: Date },
    rentalExpectedEnd:  { type: Date },

    // Lifecycle. active=false once returned/retired (FR-16).
    active:     { type: Boolean, default: true },
    returnedAt: { type: Date },

    // Relational links (models registered in later phases; refs resolve lazily).
    manifestId: { type: mongoose.Schema.Types.ObjectId, ref: "manifest" },
    waybillId:  { type: mongoose.Schema.Types.ObjectId, ref: "waybill" },

},{timestamps:true})
SkipsTrackingSchema.index({ createdAt: 1 });

const SkipTracking=mongoose.model("Skipstracking",SkipsTrackingSchema)

module.exports=SkipTracking