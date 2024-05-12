const mongoose = require('mongoose');

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

module.exports = mongoose.model('UnregisteredUser', UnregisteredUserSchema);