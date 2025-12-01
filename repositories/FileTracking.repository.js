const { checkExpiry } = require('../Global_Functions/checkExpiry');
const FileTracks=require('../models/FileTracking')
const User=require('../models/users_')
const {ExpiredTracksNotification}=require('../pushNotifications/fileTrack')

exports.createFileTrack=async(payload)=>{
    try{

        const TrackEntry=new FileTracks(payload);
        const savedTrack= await TrackEntry.save();
        return {data:savedTrack}
    }catch(error){
        console.log("this error occured in repository (file tracking)")
        console.error(error)
        throw error;
    }

}

exports.getAllFileTracks=async()=>{
    const FiletrackItems=FileTracks.find()
    return {data:FiletrackItems}
}

exports.getPaginatedTracks=async(query,limit,user,skip)=>{
    try{

        
        const [total,Tracks]=await Promise.all([
            FileTracks.countDocuments(query),
        FileTracks.find(query)
        .sort({createdAt:-1})
        .limit(limit).skip(skip)
    ])
      
    const ExpiredTracks=Tracks.filter((track)=>(
        track.status==="Expired"
    ))
    ExpiredTracks.forEach((track)=>(
        ExpiredTracksNotification(user.userId,track._id)

    ))

    const expiredTrackSummaries = ExpiredTracks.map((track) => ({
        id: track._id,
        name: track.FileName,
        expiryDate: track.ExpiresAt,
    }));
          
    const response=(Tracks.map((track=>{

        const plainTrack=track.toObject()
        
        return plainTrack;
    })))

    return {tracks:response,total:total,expiredTracks:expiredTrackSummaries}
    }catch(error){
        console.log("error at repo")
        throw error;
    }
}

exports.updateFileTrack=async(userId,payload,trackId)=>{
  
    const response=await FileTracks.findByIdAndUpdate({_id:trackId},payload,{
        new:true,runValidators:true
    })
    return {data:response}
}

exports.DeleteMultipleTracks=async(TrackIds)=>{
    try{
        //const now=new Date()
        return await FileTracks.deleteMany({_id:{$in:TrackIds}})
    }catch(error){
        console.error("this error originated from the repository layer(Delete Multiple)")
    }
}

exports.DeleteFileTrack=async(TrackId)=>{
    try{

       return await FileTracks.findByIdAndDelete(TrackId)
    }catch(error){
        console.error('this error came from the repository layer(DeleteOne)')
    }
    

}
