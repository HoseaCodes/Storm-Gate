import mongoose from 'mongoose';

const UnregisteredUserSchema = new mongoose.Schema({
    name: {
        type: String,
        trim: true
    },
    images: {
        type: String
    },
    bio: {
        type: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
})

const UnregisteredUser = mongoose.model('UnregisteredUser', UnregisteredUserSchema);

export default UnregisteredUser;