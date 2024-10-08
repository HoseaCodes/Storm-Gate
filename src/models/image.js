import mongoose from 'mongoose';

const imageSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    url: { type: String, required: true },
    public_id: { type: String, required: true }
});

const Image = mongoose.model('Image', imageSchema);

export default Image;
