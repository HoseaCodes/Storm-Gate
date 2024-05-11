import mongoose from "mongoose";
import User from "./user.js";

const options = { discriminatorKey: "kind" };

const BlogUser = User.discriminator(
  "blog",
  mongoose.Schema(
    {
      aboutMe: {
        type: String,
      },
      projects: {
        type: [String],
      },
      work: {
        type: [String],
      },
      title: {
        type: String,
        trim: true,
      },
      phone: {
        type: String,
        trim: true,
      },
      education: {
        type: [String],
      },
      skills: {
        type: [String],
        default: [],
      },
      socialMedia: {
        type: [String],
      },
      websites: {
        type: [String],
      },
      location: {
        type: String,
        trim: true,
      },
      articles: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Articles",
        },
      ],
      notifications: {
        type: [String],
        default: [],
      },
      favoriteArticles: {
        type: [String],
        default: [],
      },
      savedArticles: {
        type: [String],
        default: [],
      },
      likedArticles: {
        type: [String],
        default: [],
      },
      cart: {
        type: Array,
        default: [],
      },
    },
    options
  )
);

// const BlogUser = mongoose.model("BlogUser", blogSchema);
// Users.createIndexes();

export default BlogUser;
