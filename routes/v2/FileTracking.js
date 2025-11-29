const express=require('express')
const auth=require('../../middlewares/check-auth')
const router=express.Router();
const fileTrackingcontroller=require('../../controllers/v2.controllers/FileTracking.controllers');
const FileTracking = require('../../models/FileTracking');

//route hit when creating new File track
router.post('/createtrack',auth,fileTrackingcontroller.createFileTrack)

//route hit when getting FileTrack data
router.get('/',auth,fileTrackingcontroller.getFileTrack)


//route hit when updating track information
router.put('/:id',auth,fileTrackingcontroller.updatedTrack)

//route hit when getting paginated Filetracks
router.get('/paginatedtracks',auth,fileTrackingcontroller.getPaginatedTracks)

router.delete('/:id',auth,fileTrackingcontroller.DeleteTrack)


module.exports=router;
