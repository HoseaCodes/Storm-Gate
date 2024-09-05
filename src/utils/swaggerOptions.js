const swaggerOptions = {
    definition: {
        openapi: "3.0.0",
        info: {
            title: "StormGate API",
            version: "1.0.0",
            description: "A robust authentication API service built with Node.js and Express. Provides user authentication, file upload, and management functionalities."
        },
        servers: [
            {
                url: "http://localhost:3001", // Your API server URL
                description: "Local server"
            },
            {
                url: "http://your-ec2-public-ip:5000", // Your API server URL
                description: "Development server"
            }
        ],
        paths: {
            "/health": {
              get: {
                summary: "Health Check",
                description: "Checks the status of the API service.",
                security: [
                    {
                      basicAuth: []
                    }
                  ],
                responses: {
                  "200": {
                    description: "API is running",
                    content: {
                      "application/json": {
                        schema: {
                          type: "object",
                          properties: {
                            message: {
                              type: "string",
                              example: "API is running!"
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            },
            // "/api/file/allImages": {
            //   get: {
            //     summary: "Get All User Images",
            //     description: "Retrieves all images or documents uploaded by the authenticated user.",
            //     security: [
            //       {
            //         bearerAuth: []
            //       }
            //     ],
            //     responses: {
            //       "200": {
            //         description: "A list of images/documents",
            //         content: {
            //           "application/json": {
            //             schema: {
            //               type: "array",
            //               items: {
            //                 type: "object",
            //                 properties: {
            //                   _id: {
            //                     type: "string",
            //                     example: "60d5f0b2a0d8b4b0f0123456"
            //                   },
            //                   url: {
            //                     type: "string",
            //                     example: "http://res.cloudinary.com/demo/image/upload/v1234567890/sample.jpg"
            //                   },
            //                   public_id: {
            //                     type: "string",
            //                     example: "sample"
            //                   },
            //                   userId: {
            //                     type: "string",
            //                     example: "60d5f0b2a0d8b4b0f0123457"
            //                   }
            //                 }
            //               }
            //             }
            //           }
            //         }
            //       }
            //     }
            //   }
            // },
            // "/api/file/upload": {
            //   post: {
            //     summary: "Upload Image/Document",
            //     description: "Uploads a new image or document for the authenticated user.",
            //     security: [
            //       {
            //         bearerAuth: []
            //       }
            //     ],
            //     requestBody: {
            //       required: true,
            //       content: {
            //         "multipart/form-data": {
            //           schema: {
            //             type: "object",
            //             properties: {
            //               file: {
            //                 type: "string",
            //                 format: "binary",
            //                 description: "Image or document file to upload"
            //               }
            //             }
            //           }
            //         }
            //       }
            //     },
            //     responses: {
            //       "201": {
            //         description: "Successfully uploaded file",
            //         content: {
            //           "application/json": {
            //             schema: {
            //               type: "object",
            //               properties: {
            //                 message: {
            //                   type: "string",
            //                   example: "File uploaded successfully"
            //                 },
            //                 data: {
            //                   type: "object",
            //                   properties: {
            //                     _id: {
            //                       type: "string",
            //                       example: "60d5f0b2a0d8b4b0f0123456"
            //                     },
            //                     url: {
            //                       type: "string",
            //                       example: "http://res.cloudinary.com/demo/image/upload/v1234567890/sample.jpg"
            //                     },
            //                     public_id: {
            //                       type: "string",
            //                       example: "sample"
            //                     },
            //                     userId: {
            //                       type: "string",
            //                       example: "60d5f0b2a0d8b4b0f0123457"
            //                     }
            //                   }
            //                 }
            //               }
            //             }
            //           }
            //         }
            //       }
            //     }
            //   }
            // },
            // "/api/file/delete/{id}": {
            //   delete: {
            //     summary: "Delete Image/Document",
            //     description: "Deletes an image or document by its ID.",
            //     security: [
            //       {
            //         bearerAuth: []
            //       }
            //     ],
            //     parameters: [
            //       {
            //         name: "id",
            //         in: "path",
            //         required: true,
            //         description: "The ID of the image or document to delete",
            //         schema: {
            //           type: "string"
            //         }
            //       }
            //     ],
            //     responses: {
            //       "200": {
            //         description: "Successfully deleted file",
            //         content: {
            //           "application/json": {
            //             schema: {
            //               type: "object",
            //               properties: {
            //                 message: {
            //                   type: "string",
            //                   example: "Image deleted"
            //                 }
            //               }
            //             }
            //           }
            //         }
            //       }
            //     }
            //   }
            // },
            // "/api/auth/register": {
            //   post: {
            //     summary: "Register User",
            //     description: "Registers a new user with a username, email, and password.",
            //     requestBody: {
            //       required: true,
            //       content: {
            //         "application/json": {
            //           schema: {
            //             type: "object",
            //             properties: {
            //               username: {
            //                 type: "string",
            //                 example: "john_doe"
            //               },
            //               email: {
            //                 type: "string",
            //                 example: "john.doe@example.com"
            //               },
            //               password: {
            //                 type: "string",
            //                 example: "securepassword"
            //               }
            //             }
            //           }
            //         }
            //       }
            //     },
            //     responses: {
            //       "201": {
            //         description: "User registered successfully",
            //         content: {
            //           "application/json": {
            //             schema: {
            //               type: "object",
            //               properties: {
            //                 message: {
            //                   type: "string",
            //                   example: "User registered"
            //                 }
            //               }
            //             }
            //           }
            //         }
            //       }
            //     }
            //   }
            // },
            // "/api/auth/login": {
            //   post: {
            //     summary: "Login User",
            //     description: "Logs in a user and returns a JWT token.",
            //     requestBody: {
            //       required: true,
            //       content: {
            //         "application/json": {
            //           schema: {
            //             type: "object",
            //             properties: {
            //               email: {
            //                 type: "string",
            //                 example: "john.doe@example.com"
            //               },
            //               password: {
            //                 type: "string",
            //                 example: "securepassword"
            //               }
            //             }
            //           }
            //         }
            //       }
            //     },
            //     responses: {
            //       "200": {
            //         description: "Successfully logged in",
            //         content: {
            //           "application/json": {
            //             schema: {
            //               type: "object",
            //               properties: {
            //                 message: {
            //                   type: "string",
            //                   example: "Logged in"
            //                 },
            //                 token: {
            //                   type: "string",
            //                   example: "your_jwt_token"
            //                 }
            //               }
            //             }
            //           }
            //         }
            //       }
            //     }
            //   }
            // },
            // "/api/auth/logout": {
            //   post: {
            //     summary: "Logout User",
            //     description: "Logs out the current user by clearing the JWT token.",
            //     security: [
            //       {
            //         bearerAuth: []
            //       }
            //     ],
            //     responses: {
            //       "200": {
            //         description: "Successfully logged out",
            //         content: {
            //           "application/json": {
            //             schema: {
            //               type: "object",
            //               properties: {
            //                 message: {
            //                   type: "string",
            //                   example: "Logged out"
            //                 }
            //               }
            //             }
            //           }
            //         }
            //       }
            //     }
            //   }
            // },
            // "/api/auth/refresh_token": {
            //   post: {
            //     summary: "Refresh JWT Token",
            //     description: "Refreshes the JWT token to extend the session.",
            //     security: [
            //       {
            //         bearerAuth: []
            //       }
            //     ],
            //     responses: {
            //       "200": {
            //         description: "Successfully refreshed token",
            //         content: {
            //           "application/json": {
            //             schema: {
            //               type: "object",
            //               properties: {
            //                 token: {
            //                   type: "string",
            //                   example: "new_jwt_token"
            //                 }
            //               }
            //             }
            //           }
            //         }
            //       }
            //     }
            //   }
            // },
            // "/api/auth/info": {
            //   get: {
            //     summary: "Get User Info",
            //     description: "Retrieves information about the current user.",
            //     security: [
            //       {
            //         bearerAuth: []
            //       }
            //     ],
            //     responses: {
            //       "200": {
            //         description: "User information retrieved",
            //         content: {
            //           "application/json": {
            //             schema: {
            //               type: "object",
            //               properties: {
            //                 id: {
            //                   type: "string",
            //                   example: "60d5f0b2a0d8b4b0f0123457"
            //                 },
            //                 username: {
            //                   type: "string",
            //                   example: "john_doe"
            //                 },
            //                 email: {
            //                   type: "string",
            //                   example: "john.doe@example.com"
            //                 }
            //               }
            //             }
            //           }
            //         }
            //       }
            //     }
            //   }
            // },
            // "/api/auth/edit/{id}": {
            //   put: {
            //     summary: "Edit User Information",
            //     description: "Updates information for a user by their ID.",
            //     security: [
            //       {
            //         bearerAuth: []
            //       }
            //     ],
            //     parameters: [
            //       {
            //         name: "id",
            //         in: "path",
            //         required: true,
            //         description: "The ID of the user to update",
            //         schema: {
            //           type: "string"
            //         }
            //       }
            //     ],
            //     requestBody: {
            //       required: true,
            //       content: {
            //         "application/json": {
            //           schema: {
            //             type: "object",
            //             properties: {
            //               username: {
            //                 type: "string",
            //                 example: "john_doe"
            //               },
            //               email: {
            //                 type: "string",
            //                 example: "john.doe@example.com"
            //               }
            //             }
            //           }
            //         }
            //       }
            //     },
            //     responses: {
            //       "200": {
            //         description: "User information updated",
            //         content: {
            //           "application/json": {
            //             schema: {
            //               type: "object",
            //               properties: {
            //                 message: {
            //                   type: "string",
            //                   example: "User information updated"
            //                 }
            //               }
            //             }
            //           }
            //         }
            //       }
            //     }
            //   }
            // },
            // "/api/auth/users": {
            //   get: {
            //     summary: "Get All Users",
            //     description: "Retrieves a list of all registered users.",
            //     security: [
            //       {
            //         bearerAuth: []
            //       }
            //     ],
            //     responses: {
            //       "200": {
            //         description: "List of all users",
            //         content: {
            //           "application/json": {
            //             schema: {
            //               type: "array",
            //               items: {
            //                 type: "object",
            //                 properties: {
            //                   id: {
            //                     type: "string",
            //                     example: "60d5f0b2a0d8b4b0f0123457"
            //                   },
            //                   username: {
            //                     type: "string",
            //                     example: "john_doe"
            //                   },
            //                   email: {
            //                     type: "string",
            //                     example: "john.doe@example.com"
            //                   }
            //                 }
            //               }
            //             }
            //           }
            //         }
            //       }
            //     }
            //   }
            // },
            // "/api/auth/user/{id}": {
            //   get: {
            //     summary: "Get User by ID",
            //     description: "Retrieves information about a specific user by their ID.",
            //     security: [
            //       {
            //         bearerAuth: []
            //       }
            //     ],
            //     parameters: [
            //       {
            //         name: "id",
            //         in: "path",
            //         required: true,
            //         description: "The ID of the user to retrieve",
            //         schema: {
            //           type: "string"
            //         }
            //       }
            //     ],
            //     responses: {
            //       "200": {
            //         description: "User information retrieved",
            //         content: {
            //           "application/json": {
            //             schema: {
            //               type: "object",
            //               properties: {
            //                 id: {
            //                   type: "string",
            //                   example: "60d5f0b2a0d8b4b0f0123457"
            //                 },
            //                 username: {
            //                   type: "string",
            //                   example: "john_doe"
            //                 },
            //                 email: {
            //                   type: "string",
            //                   example: "john.doe@example.com"
            //                 }
            //               }
            //             }
            //           }
            //         }
            //       }
            //     }
            //   }
            // },
            // "/api/auth/delete/{id}": {
            //   delete: {
            //     summary: "Delete User by ID",
            //     description: "Deletes a user by their ID.",
            //     security: [
            //       {
            //         bearerAuth: []
            //       }
            //     ],
            //     parameters: [
            //       {
            //         name: "id",
            //         in: "path",
            //         required: true,
            //         description: "The ID of the user to delete",
            //         schema: {
            //           type: "string"
            //         }
            //       }
            //     ],
            //     responses: {
            //       "200": {
            //         description: "User deleted",
            //         content: {
            //           "application/json": {
            //             schema: {
            //               type: "object",
            //               properties: {
            //                 message: {
            //                   type: "string",
            //                   example: "User deleted"
            //                 }
            //               }
            //             }
            //           }
            //         }
            //       }
            //     }
            //   }
            // }
          },
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                    bearerFormat: "JWT"
                }
            }
        }
    },

    apis: ['./src/routes/*.js'], // Path to the API docs
};


export default swaggerOptions;
