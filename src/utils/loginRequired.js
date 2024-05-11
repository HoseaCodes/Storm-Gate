const loginRequired = (req, res, next) => {
  return (req.user || req.params.id ? next() : res.status(401).json({message: 'Unauthorized user'}));
}

export default loginRequired;
