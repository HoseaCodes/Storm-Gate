import Users from "../models/user.js";

const isAdmin = async (req, res, next) => {
    try {
      const user = await Users.find({
        _id: req.params.id
      })
      console.log(user)
        if (user.role === 0 || user.role !== "admin")
            return res.status(401).json({ msg: "Not allowed: You don't have enough permission to perform this action" })
        next()
    } catch (err) {
        return res.status(500).json({ msg: err.message })

    }
}


export default isAdmin;
