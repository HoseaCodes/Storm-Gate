
import jwt from "jsonwebtoken";
import User from "../models/user.js";

const auth = (req, res, next) => {
	try {
		const token = req.header("Authorization");
		if (!token)
			return res.status(400).json({ msg: "Invalid Authentication - no token" });

		jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
      if (err instanceof jwt.TokenExpiredError) {
        return res
        .status(400)
        .json({ msg: "Token Expired Error", err});
      }
      if (err)
				return res
					.status(400)
					.json({ msg: "Invalid Authentication - invalid token"});

			req.user = user;
			next();
		});
	} catch (err) {
		return res.status(500).json({ msg: err.message });
	}
};

export async function authRole(req, res, next) {
  console.log(req);
  try {
    const newUser = await User.findById(userId);

    for (let role of roles) {
      if (newUser.role == role) {
        next();
      }
    }

    return res.status(401).json({
      error:
        "Not allowed: You don't have enough permission to perform this action",
    });
  } catch (error) {
    return res.status(500).json({ msg: err.message });
  }
}


export const createAccessToken = (user) => {
  return jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1d" });
};

export const createRefreshToken = (user) => {
  return jwt.sign(user, process.env.REFRESH_TOKEN_SECRET, { expiresIn: "7d" });
};

export default auth;
