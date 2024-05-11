import Users from "../models/user.js";

const authAdmin = async (req, res, next) => {
    try {
      const user = await Users.find({
        _id: req.params.id
      })
      console.log(user)
        if (user.role === 0)
            return res.status(400).json({ msg: "Admin resources access denied" })
        next()
    } catch (err) {
        return res.status(500).json({ msg: err.message })

    }
}


export default authAdmin;
