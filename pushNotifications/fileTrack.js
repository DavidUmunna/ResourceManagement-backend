const {sendPushNotification}=require('../Global_Functions/firebasePushNotification')
const user=require('../models/users_')
const track=require('../models/FileTracking')
const ExpiredTracksNotification=async(userId,trackid)=>{
try{
    const currentUser=await user.findById(userId)
    if(!currentUser){
        throw new Error("USER_NOT_FOUND")
    }
    const token=currentUser.NotificationToken
    const Track=await track.findById(trackid)
    if(!trackid){
        throw new Error("TRACK_NOT_FOUND")
    }
    const title="Expiration Reminder!!"
    const body=`this track ${Track.FileName} expired on ${Track.ExpiresAt} and needs to be renewed`
    sendPushNotification(token,title,body)
}catch(error){
    console.error("an error occurred",error)
}
}

module.exports={ExpiredTracksNotification}