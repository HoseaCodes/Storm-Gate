import mongoose from "mongoose";

const options = { discriminatorKey: "kind" };

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    username: {
      type: String,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
    },
    avatar: {
      type: Object,
      required: true,
      default:
        "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT0k6I8WItSjK0JTttL3FwACOA6yugI29xvLw&usqp=CAU",
    },
    socialMediaHandles: {
      type: Map,
      of: String,
    },
    // role: {
    //   type: Number,
    //   default: 0,
    // },
    application: {
      type: String,
      required: true,
    },
    profile: { type: mongoose.Schema.Types.ObjectId, refPath: "role" },
  },
  {
    timestamps: true,
  },
  { strict: false },
  options
);

const User = mongoose.model("User", userSchema);
// Users.createIndexes();

export default User;
