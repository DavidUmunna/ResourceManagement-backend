const {
  predictiveMaintenanceSystemPrompt,
  labInterpretationSystemPrompt,
  logisticsSystemPrompt,
  reportingSystemPrompt,
} = require("./ai.prompts");
const { runGemini } = require("./geminiClient");

const normalizeResponse = (aiResponse, mapping) => {
  const result = {};
  Object.entries(mapping).forEach(([targetKey, sourceKeys]) => {
    const value = sourceKeys.reduce((acc, key) => {
      if (acc !== undefined && acc !== null) return acc;
      return aiResponse[key];
    }, undefined);
    result[targetKey] = value;
  });
  return result;
};

const handleAiCall = async (res, systemPrompt, userPrompt, mapping) => {
  const aiResponse = await runGemini(systemPrompt, userPrompt);
  if (aiResponse?.error) {
    return res.status(500).json({ success: false, message: aiResponse.message });
  }
  return res.status(200).json({ success: true, data: normalizeResponse(aiResponse, mapping) });
};

const predictiveMaintenanceMapping = {
  risk_level: ["risk_level", "riskLevel", "risk"],
  predicted_failure_days: ["predicted_failure_days", "predictedFailureDays"],
  recommended_action: ["recommended_action", "recommendedAction", "action"],
  reasoning: ["reasoning", "reason"],
};

const labMapping = {
  compliance_status: ["compliance_status", "complianceStatus", "status"],
  exceeded_parameters: ["exceeded_parameters", "exceededParameters", "flags"],
  recommended_actions: ["recommended_actions", "recommendedActions", "actions"],
  environmental_risk_summary: ["environmental_risk_summary", "environmentalRiskSummary", "summary"],
};

const logisticsMapping = {
  optimized_routes: ["optimized_routes", "optimizedRoutes"],
  costEstimate: ["costEstimate", "cost"],
  etaMinutes: ["etaMinutes", "eta"],
  notes: ["notes"],
};

const reportMapping = {
  executiveSummary: ["executiveSummary", "summary"],
  keyFindings: ["keyFindings"],
  correctiveActions: ["correctiveActions"],
  deadlines: ["deadlines"],
  overallRisk: ["overallRisk", "risk"],
};

const predictiveMaintenance = async (req, res) => {
  try {
    const {
      equipmentType,
      runtime,
      vibration,
      temperature,
      lastService,
      flow,
      notes,
    } = req.body || {};

    const userPrompt = `
Equipment Type: ${equipmentType || "unknown"}
Runtime (hours): ${runtime ?? "n/a"}
Vibration: ${vibration ?? "n/a"}
Temperature: ${temperature ?? "n/a"}
Last Service Date: ${lastService || "n/a"}
Flow Rate: ${flow ?? "n/a"}
Notes: ${notes || "none"}
Return JSON with: risk_level, predicted_failure_days, recommended_action, reasoning.
    `.trim();

    return await handleAiCall(res, predictiveMaintenanceSystemPrompt, userPrompt, predictiveMaintenanceMapping);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const interpretLabResults = async (req, res) => {
  try {
    const {
      sampleType,
      cod,
      bod,
      tss,
      metals,
      ph,
      limitSource,
      notes,
    } = req.body || {};

    const userPrompt = `
Sample Type: ${sampleType || "unknown"}
COD (mg/L): ${cod ?? "n/a"}
BOD (mg/L): ${bod ?? "n/a"}
TSS (mg/L): ${tss ?? "n/a"}
Metals (list w/ values): ${metals ? JSON.stringify(metals) : "n/a"}
pH: ${ph ?? "n/a"}
Limit Source: ${limitSource || "n/a"}
Notes: ${notes || "none"}
Return JSON with: compliance_status, exceeded_parameters, recommended_actions, environmental_risk_summary.
    `.trim();

    return await handleAiCall(res, labInterpretationSystemPrompt, userPrompt, labMapping);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const optimizeLogistics = async (req, res) => {
  try {
    const { origins, destinations, constraints, vehicles, notes } = req.body || {};

    const userPrompt = `
Origins: ${origins ? JSON.stringify(origins) : "n/a"}
Destinations: ${destinations ? JSON.stringify(destinations) : "n/a"}
Constraints: ${constraints ? JSON.stringify(constraints) : "n/a"}
Vehicles/Capacity: ${vehicles ? JSON.stringify(vehicles) : "n/a"}
Notes: ${notes || "none"}
Return JSON with: optimized_routes, costEstimate, etaMinutes, notes.
    `.trim();

    return await handleAiCall(res, logisticsSystemPrompt, userPrompt, logisticsMapping);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const generateComplianceReport = async (req, res) => {
  try {
    const { scope, findings, deadlines, region, notes } = req.body || {};

    const userPrompt = `
Scope: ${scope || "n/a"}
Findings: ${findings ? JSON.stringify(findings) : "n/a"}
Deadlines: ${deadlines ? JSON.stringify(deadlines) : "n/a"}
Region: ${region || "n/a"}
Notes: ${notes || "none"}
Return JSON with: executiveSummary, keyFindings, correctiveActions, deadlines, overallRisk.
    `.trim();

    return await handleAiCall(res, reportingSystemPrompt, userPrompt, reportMapping);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  predictiveMaintenance,
  interpretLabResults,
  optimizeLogistics,
  generateComplianceReport,
};
