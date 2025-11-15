# Storm Gate API Documentation

This document outlines all available API endpoints in the Storm Gate application.

## Authentication Endpoints

### Register User
- **URL:** `/register`
- **Method:** `POST`
- **Description:** Register a new user
- **Request Body:**
  ```json
  {
    "name": "string",
    "email": "string",
    "password": "string",
    "role": "string",
    "application": "string"
  }
  ```
- **Success Response:** `200 OK` with access token
- **Error Responses:** 
  - `409` Email already exists
  - `401` Invalid password length
  - `500` Internal Server Error

### Login
- **URL:** `/api/user/login`
- **Method:** `POST`
- **Description:** Authenticate user and receive access token
- **Request Body:**
  ```json
  {
    "email": "string",
    "password": "string",
    "rememberMe": "boolean"
  }
  ```
- **Success Response:** `200 OK` with access and refresh tokens

### Logout
- **URL:** `/api/user/logout`
- **Method:** `POST`
- **Description:** Logs out user and clears refresh token cookie
- **Success Response:** `200 OK` with success message

### Refresh Token
- **URL:** `/refresh_token`
- **Method:** `GET`
- **Description:** Refresh the access token using refresh token cookie
- **Success Response:** `200 OK` with new access token
- **Error Responses:**
  - `401` Unauthorized - Please verify info & login
  - `400` Bad request - Please login or register

## User Management Endpoints

### Get User Info
- **URL:** `/api/user/info`
- **Method:** `GET`
- **Description:** Get details of the currently authenticated user
- **Authentication:** Required
- **Cache:** Enabled
- **Success Response:** `200 OK` with user details
- **Error Responses:**
  - `400` User does not exist
  - `401` Permission denied

### Get Current User
- **URL:** `/api/user`
- **Method:** `GET`
- **Description:** Get details of the currently authenticated user
- **Authentication:** Required

### Create User Profile
- **URL:** `/api/user/create`
- **Method:** `POST`
- **Description:** Add a new user profile with images and details
- **Request Body:**
  ```json
  {
    "images": ["string"],
    "user": {
      "name": "string",
      "bio": "string"
    }
  }
  ```
- **Success Response:** `200 OK` with profile data

### Update User Profile
- **URL:** `/api/user/profile/{id}`
- **Method:** `PUT`
- **Description:** Update a user's profile information
- **Authentication:** Required

### Edit User
- **URL:** `/api/user/edit/{id}`
- **Method:** `PUT`
- **Description:** Edit user information
- **Authentication:** Admin Required

### Get All Users
- **URL:** `/api/users`
- **Method:** `GET`
- **Description:** Get a list of all users
- **Authentication:** Admin Required

### Add New User
- **URL:** `/api/user`
- **Method:** `POST`
- **Description:** Add a new user (Admin function)
- **Authentication:** Admin Required

### Delete User
- **URL:** `/api/user/{id}`
- **Method:** `DELETE`
- **Description:** Delete a user by ID
- **Authentication:** Admin Required

## Image Management Endpoints

### Get All Uploads
- **URL:** `/uploads/allImages`
- **Method:** `POST`
- **Description:** Get all uploads from Cloudinary in the specified folder
- **Cache:** Enabled

### Get User Images
- **URL:** `/uploads/images`
- **Method:** `POST`
- **Description:** Get all images uploaded by the authenticated user

### Upload Image
- **URL:** `/uploads/upload`
- **Method:** `POST`
- **Description:** Upload an image to Cloudinary
- **Request Body:** Form data with image file

### Delete Cloudinary Image
- **URL:** `/uploads/destory`
- **Method:** `POST`
- **Description:** Remove an image from Cloudinary by public_id

### Delete Image by ID
- **URL:** `/uploads/image/{id}`
- **Method:** `POST`
- **Description:** Delete an image by its database ID
