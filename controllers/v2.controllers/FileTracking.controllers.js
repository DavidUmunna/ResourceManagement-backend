const FileTrackingService=require('../../services/FileTracking.service')
const {getPagination,getPagingData}=require("../../Global_Functions/pagination")

exports.createFileTrack=async(req,res)=>{
    try{
        const user=req.user
        const {FileName,Issuer,ExpiresAt,IssuedTo,
            IssueDate,status}=req.body
        const payload={
            FileName,Issuer,ExpiresAt,IssuedTo,
            IssueDate,status
        }
        const ServiceResponse=await FileTrackingService.createFileTrack(payload,user)
        return res.status(201).json({success:true,data:ServiceResponse.data})
    }catch(error){
        console.error('this error occurred in the controller layer of the filetracking component(create track) ')
        console.log(error)
        return res.status(500).json({message:"Server Error"})
    }

}


exports.getPaginatedTracks=async(req,res)=>{
    try{
        const currentUser=req.user
         const { page, limit, skip } = getPagination(req);
        const serviceRepository=await FileTrackingService.getPaginatedTracks(currentUser,limit)

      
  
        return  res.status(200).json({success:true,data:serviceRepository.data,Pagination:getPagingData(serviceRepository.total,page,limit)})

    }catch(error){
        res.status(500).json({message:"server Error"})
        console.error('this error occurred in the controller layer of the filetracking component(paginatedorders track) ')
        console.log(error)

    }
}

exports.getFileTrack=async(req,res)=>{
    try{
        const currentUser=req.user

        const FileTrackItems=await FileTrackingService.getFileTracks(currentUser)
        
        return res.status(200).json({success:true,data:FileTrackItems.data})

    }catch(error){
        console.error('this error occurred in the controller layer of the filetracking component(get tracks) ')
        console.log(error)
        return res.status(500).json({message:'An error occured while getting FileTracks'})

    }
}

exports.updatedTrack=async(req,res)=>{
    try{
        const {id}=req.params
        const trackId=id
        
        const currentUser=req.user
        const {FileName,Issuer,ExpiresAt,IssuedTo,fileUrl,
            IssueDate,status}=req.body
        const payload={
            FileName,Issuer,ExpiresAt,IssuedTo,
            IssueDate,status,fileUrl
        }
        const serviceResponse=await FileTrackingService.updateTrack(currentUser,payload,trackId)
        return res.status(200).json({success:true,data:serviceResponse.data})

    }catch(error){
          console.error('this error occurred in the controller layer of the filetracking component(update tracks) ')
        console.log(error)
        return res.status(500).json({success:false,message:'An error occured while updating FileTracks'})

    }
}

exports.DeleteTrack=async(req,res)=>{
    try{
        const {id}=req.params

        const currentUser=req.user
        await FileTrackingService.DeleteTrack(currentUser,id)
        return  res.status(200).json({message:"Deleted Successfully"})


    }catch(error){
        console.error("controller layer (Delete error)")
        console.log(error)
        return res.status(500).json({message:"Server Error"})

    }
}

