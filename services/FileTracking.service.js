const FileTrackingRepository=require('../repositories/FileTracking.repository')
const user_=require('../models/users_')
const FileTrackModel=require('../models/FileTracking')
const ComplianceLogService = require('./ComplianceLog.service');

exports.createFileTrack=async(payload,user)=>{
    try{
        const {userId}=user
        console.log(userId)

        const User=await user_.findOne({_id:userId})
        if (!User) {
              throw new Error("USER_NOT_FOUND")
        }  
        const response=await FileTrackingRepository.createFileTrack(payload)

        // audit create
        try{
            await ComplianceLogService.logAction(user,{
                action:"CREATE",
                entityId:response.data?._id,
                entityName:response.data?.FileName,
                entityType:"FileTrack",
                statusAfter:response.data?.status,
                metadata:{
                    issuer:response.data?.Issuer,
                    issuedTo:response.data?.IssuedTo,
                    expiresAt:response.data?.ExpiresAt
                }
            })
        }catch(logErr){
            console.error("Failed to log compliance for create filetrack:",logErr)
        }
        return {data:response.data}



    }catch(error){
        console.error("an error occured in the fileupload service layer(createFilelTrack)")
        console.log(error)
    }
}


exports.getPaginatedTracks=async(user,limit,skip)=>{
    try{
        const query={}
        const currentUser=await user_.findOne({_id:user.userId})
        if(!currentUser){
            throw new Error("USER_NOT_FOUND")
        }
        const repositoryResponse=await FileTrackingRepository.getPaginatedTracks(query,limit,user,skip)
   
        return {data:repositoryResponse.tracks,total:repositoryResponse.total}

    }catch(error){
        console.error("an error occured in the file tracking service layer(getPaginatedFilelTracks)")
        console.log(error)
        throw error;

    }
}

exports.DeleteTrack=async(user,TrackId)=>{
    try{
        const currentUser=await user_.findOne({_id:user.userId})
        if(!currentUser){
            throw new Error("USER_NOT_FOUND")
        }
        const trackToDelete=await FileTrackModel.findById(TrackId).lean()
        await FileTrackingRepository.DeleteFileTrack(TrackId)

        if(trackToDelete){
            try{
                await ComplianceLogService.logAction(user,{
                    action:"DELETE",
                    entityId:TrackId,
                    entityName:trackToDelete.FileName,
                    entityType:"FileTrack",
                    statusBefore:trackToDelete.status,
                    metadata:{
                        issuer:trackToDelete.Issuer,
                        issuedTo:trackToDelete.IssuedTo,
                        expiresAt:trackToDelete.ExpiresAt
                    }
                })
            }catch(logErr){
                console.error("Failed to log compliance for delete filetrack:",logErr)
            }
        }

        return {success:true}
    }catch(error){
        console.log(error)
        throw error;

    }
}

exports.updateTrack=async(user,payload,trackId)=>{
    try{
        const {userId}=user
        const currentUser=await user_.findOne({_id:user.userId})
        if(!currentUser){
            throw new Error("USER_NOT_FOUND")
        }
        const beforeUpdate=await FileTrackModel.findById(trackId).lean()
        const repositoryResponse=await FileTrackingRepository.updateFileTrack(userId,payload,trackId)
        console.log("update",repositoryResponse)

        if(beforeUpdate || repositoryResponse?.data){
            const afterUpdate=repositoryResponse?.data
            const changedFields=Object.keys(payload||{}).filter((field)=>beforeUpdate && payload[field]!==beforeUpdate[field])
            try{
                await ComplianceLogService.logAction(user,{
                    action:"UPDATE",
                    entityId:trackId,
                    entityName:afterUpdate?.FileName || beforeUpdate?.FileName,
                    entityType:"FileTrack",
                    changedFields,
                    statusBefore:beforeUpdate?.status,
                    statusAfter:afterUpdate?.status,
                    metadata:{
                        issuer:afterUpdate?.Issuer || beforeUpdate?.Issuer,
                        issuedTo:afterUpdate?.IssuedTo || beforeUpdate?.IssuedTo,
                        expiresAt:afterUpdate?.ExpiresAt || beforeUpdate?.ExpiresAt
                    }
                })
            }catch(logErr){
                console.error("Failed to log compliance for update filetrack:",logErr)
            }
        }
        return {data:repositoryResponse.data}

    }catch(error){
        console.error("an error occured in the fileupload service layer(UpdateTrack)")
        console.log(error)
        throw error;

    }
}

exports.getFileTracks=async(user)=>{
    try{
        const currentUser=await user_.findOne({_id:user.userId})
        if(!currentUser){
            throw new Error("USER_NOT_FOUND")
        }
        const repositoryResponse=await FileTrackingRepository.getAllFileTracks()
        return {data:repositoryResponse.data}
    }catch(error){
        console.error("an error occured in the fileupload service layer(getFilelTracks)")
        console.log(error)
        throw error;
    }
}
